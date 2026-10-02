"""Registration and login.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

import bcrypt
import mysql.connector
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token
from mysql.connector import Error

from rate_limit import (
    address_key,
    login_key,
    record_failed_login,
    too_many_failed_logins,
)

from categories import DEFAULT_TIME_CATEGORIES, DEFAULT_TODO_CATEGORIES

import app

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/register", methods=["POST"])
# Keyed by address, not by the submitted username: an attacker chooses that
# field freely, so keying on it would hand out a fresh budget per attempt. The
# caps are higher than the per-user limits elsewhere because this is the one
# endpoint that stays a shared bucket while the browser reaches Flask through a
# single container — see rate_limit.py.
@app.limiter.limit("10 per minute", key_func=address_key)
@app.limiter.limit("40 per hour", key_func=address_key)
def register_user():
    """
    Register a new user.

    Expected JSON payload:
    {
        "username": "string",
        "password": "string"
    }

    Returns:
        201: User created successfully
        400: Missing fields or validation error
        409: Username already exists
        500: Server error
    """
    data = request.get_json()

    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password are required"}), 400

    username = data["username"].strip()
    password = data["password"]

    # Validate input
    if not username or len(username) > 100:
        return jsonify({"error": "Username must be between 1 and 100 characters"}), 400

    if not password or len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    pwd_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (username, pwd_hash) VALUES (%s, %s)",
                (username, pwd_hash),
            )
            user_id = cursor.lastrowid

            # The category tables are scoped per user, so a new account owns
            # nothing and would open every picker empty. Seeding runs on the
            # same cursor, inside the one transaction get_cursor() opened, so a
            # seed that fails takes the half-made account down with it rather
            # than leaving one that can never categorize anything.
            #
            # Neither insert can raise IntegrityError: the id is fresh, so
            # nothing can already occupy (user_id, name). That matters because
            # the handler below answers IntegrityError with "Username already
            # exists", which would be a lie about a seed failure.
            cursor.executemany(
                "INSERT INTO category (user_id, name) VALUES (%s, %s)",
                [(user_id, name) for name in DEFAULT_TIME_CATEGORIES],
            )
            cursor.executemany(
                "INSERT INTO todo_categories (user_id, name) VALUES (%s, %s)",
                [(user_id, name) for name in DEFAULT_TODO_CATEGORIES],
            )

        return jsonify(
            {
                "message": "User registered successfully",
                "user_id": user_id,
                "username": username,
            }
        ), 201

    except mysql.connector.IntegrityError:
        return jsonify({"error": "Username already exists"}), 409

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to register user"}), 500


@auth_bp.route("/login", methods=["POST"])
# A volume cap only, bounding the bcrypt work an unauthenticated caller can
# demand. The throttle that stops password guessing is per account and lives in
# the body of this function, because it may only refuse an attempt already known
# to be wrong — see rate_limit.py.
@app.limiter.limit("30 per minute", key_func=address_key)
@app.limiter.limit("200 per hour", key_func=address_key)
def login_user():
    """
    Login a user.

    Expected JSON payload:
    {
        "username": "string",
        "password": "string"
    }

    Returns:
        200: Login successful (with user info)
        400: Missing fields
        401: Invalid credentials
        429: Too many wrong guesses against this account
        500: Server error
    """
    data = request.get_json()

    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password are required"}), 400

    username = data["username"].strip()
    password = data["password"]

    try:
        user, refusal = authenticate(username, password)
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Login failed"}), 500

    if refusal:
        return refusal

    access_token = create_access_token(identity=username)
    return jsonify(
        {
            "message": "Login successful",
            "authenticated": True,
            "user_id": user["id"],
            "username": user["username"],
            "access_token": access_token,
        }
    ), 200


def authenticate(username, password):
    """Check a password, charging a wrong one to the account's throttle.

    Returns `(user, None)` when the password is right, or `(None, refusal)`
    with a ready (response, status) when it is not. Shared by `/login` and
    `/devices/pair`, which both take a password: they draw on one budget of
    wrong guesses per account, so pairing is not a second way to guess.
    Database errors propagate for the caller to answer.
    """
    with app.get_cursor() as cursor:
        cursor.execute(
            "SELECT id, username, pwd_hash FROM users WHERE username = %s",
            (username,),
        )
        user = cursor.fetchone()

    attempt_key = login_key()

    # A correct password is answered before the throttle is consulted, so a
    # guessing run against someone's username can never shut them out of their
    # own account. Everything below this point is a failed attempt.
    if user and bcrypt.checkpw(password.encode("utf-8"), bytes(user["pwd_hash"])):
        return user, None

    if too_many_failed_logins(attempt_key):
        # Already over budget, so this guess is not charged — the window should
        # drain on its own rather than being extended by continued guessing.
        return None, (
            jsonify({"error": "Too many failed attempts for this account. Please wait."}),
            429,
        )

    record_failed_login(attempt_key)
    # Unchanged wording whether the username or the password was wrong: saying
    # which would turn this endpoint into a test for whether an account exists.
    return None, (jsonify({"error": "Invalid username or password"}), 401)

