"""Pairing and managing the phones that run the Namu Android app.

A phone pairs once with a username and password and receives a device token
(see device_tokens.py). From then on it authenticates with that token alone; the
password is never stored on the phone. Pairing, checking a pairing and unpairing
are the phone's side. Listing and revoking are the web app's, under the usual
JWT, so a lost phone can be cut off from anywhere.

Route modules reach shared state through `import app`; see routes/auth.py.
"""

import logging
from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

from device_tokens import generate_token, hash_token, token_from_header
from rate_limit import address_key
from routes.auth import authenticate
from users import resolve_user_id

import app

logger = logging.getLogger(__name__)

devices_bp = Blueprint("devices", __name__)

MAX_DEVICE_NAME_LENGTH = 100

# Every device route also has an address-keyed cap. The default limits key a
# device request by its token's hash without checking the token exists, so on
# their own a caller could make up a fresh token, and get a fresh bucket, per
# request. See limiter_key in rate_limit.py.
DEVICE_ADDRESS_LIMIT = "120 per minute"


def _now_utc():
    """Naive UTC to the second, which is how every DATETIME column here is
    stored. Truncated so a value echoed back matches what a later read returns."""
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _iso(value):
    """A stored UTC DATETIME as ISO 8601, or None."""
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def _device_json(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": _iso(row["created_at"]),
        "last_seen_at": _iso(row["last_seen_at"]),
        "revoked_at": _iso(row["revoked_at"]),
    }


def device_required(view):
    """Authenticate the request by its device token.

    Sets `g.device` to the device row joined with its owner's username. A
    missing, malformed or unknown token is 401, and so is a revoked one, with
    its own message so the app can tell the user it was unpaired.
    """

    @wraps(view)
    def wrapper(*args, **kwargs):
        token = token_from_header(request.headers.get("Authorization"))
        if not token:
            return jsonify({"error": "Missing or invalid device token"}), 401

        try:
            with app.get_cursor() as cursor:
                cursor.execute(
                    """
                    SELECT d.id, d.user_id, d.name, d.created_at, d.last_seen_at,
                           d.revoked_at, u.username
                    FROM devices d
                    JOIN users u ON u.id = d.user_id
                    WHERE d.token_hash = %s
                    """,
                    (hash_token(token),),
                )
                device = cursor.fetchone()
        except Error as e:
            logger.error(f"Database error: {e}")
            return jsonify({"error": "Could not verify device"}), 500

        if not device:
            return jsonify({"error": "Missing or invalid device token"}), 401
        if device["revoked_at"] is not None:
            return jsonify({"error": "This device has been unpaired"}), 401

        g.device = device
        return view(*args, **kwargs)

    return wrapper


# ─── The phone's side ─────────────────────────────────────────────────────────


@devices_bp.route("/devices/pair", methods=["POST"])
# The same address caps as /login: every attempt costs a bcrypt comparison.
# Wrong passwords are charged to the account's failed-login budget inside
# authenticate(), shared with /login.
@app.limiter.limit("30 per minute", key_func=address_key)
@app.limiter.limit("200 per hour", key_func=address_key)
def pair_device():
    """
    Pair a phone with an account.

    Expected JSON payload:
    {
        "username": "string",
        "password": "string",
        "device_name": "string"
    }

    Returns:
        201: Paired, with the device token. It is shown this once only
        400: Missing or invalid fields
        401: Invalid credentials
        429: Too many wrong guesses against this account
        500: Server error
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Username, password and device name are required"}), 400

    username = data.get("username")
    password = data.get("password")
    device_name = data.get("device_name")
    if not all(isinstance(v, str) for v in (username, password, device_name)):
        return jsonify({"error": "Username, password and device name are required"}), 400

    username = username.strip()
    device_name = device_name.strip()
    if not username or not password or not device_name:
        return jsonify({"error": "Username, password and device name are required"}), 400
    if len(device_name) > MAX_DEVICE_NAME_LENGTH:
        return jsonify(
            {"error": f"Device name must be at most {MAX_DEVICE_NAME_LENGTH} characters"}
        ), 400

    try:
        user, refusal = authenticate(username, password)
        if refusal:
            return refusal

        token = generate_token()
        with app.get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO devices (user_id, name, token_hash) VALUES (%s, %s, %s)",
                (user["id"], device_name, hash_token(token)),
            )
            device_id = cursor.lastrowid
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Pairing failed"}), 500

    return jsonify(
        {
            "device_id": device_id,
            "name": device_name,
            "username": user["username"],
            "token": token,
        }
    ), 201


@devices_bp.route("/devices/me", methods=["GET"])
@app.limiter.limit(DEVICE_ADDRESS_LIMIT, key_func=address_key)
@device_required
def current_device():
    """
    The pairing this token belongs to. Also records that the phone was seen.

    Returns:
        200: The device and the username it is paired as
        401: Missing, invalid or revoked token
    """
    device = g.device
    seen_at = _now_utc()
    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "UPDATE devices SET last_seen_at = %s WHERE id = %s",
                (seen_at, device["id"]),
            )
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load device"}), 500

    return jsonify(
        {
            **_device_json({**device, "last_seen_at": seen_at}),
            "username": device["username"],
        }
    ), 200


@devices_bp.route("/devices/me/revoke", methods=["POST"])
@app.limiter.limit(DEVICE_ADDRESS_LIMIT, key_func=address_key)
@device_required
def revoke_current_device():
    """
    Unpair from the phone. The token stops working immediately.

    Returns:
        200: Revoked
        401: Missing, invalid or already revoked token
    """
    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "UPDATE devices SET revoked_at = %s WHERE id = %s AND revoked_at IS NULL",
                (_now_utc(), g.device["id"]),
            )
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not unpair device"}), 500

    return jsonify({"message": "Device unpaired", "id": g.device["id"]}), 200


# ─── The web app's side ───────────────────────────────────────────────────────


@devices_bp.route("/devices", methods=["GET"])
@jwt_required()
def list_devices():
    """
    The caller's paired phones, newest first, revoked ones included.

    Returns:
        200: {"devices": [...]}
        404: The token's user no longer exists
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            cursor.execute(
                """
                SELECT id, name, created_at, last_seen_at, revoked_at
                FROM devices
                WHERE user_id = %s
                ORDER BY created_at DESC, id DESC
                """,
                (user_id,),
            )
            rows = cursor.fetchall()
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load devices"}), 500

    return jsonify({"devices": [_device_json(row) for row in rows]}), 200


@devices_bp.route("/devices/<int:device_id>/revoke", methods=["POST"])
@jwt_required()
def revoke_device(device_id):
    """
    Revoke one of the caller's phones. Revoking twice keeps the first time.

    Returns:
        200: Revoked (or already was)
        404: No such device for this user, including another user's device
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            cursor.execute(
                "SELECT id FROM devices WHERE id = %s AND user_id = %s",
                (device_id, user_id),
            )
            if not cursor.fetchone():
                return jsonify({"error": "Device not found"}), 404
            cursor.execute(
                """
                UPDATE devices SET revoked_at = %s
                WHERE id = %s AND user_id = %s AND revoked_at IS NULL
                """,
                (_now_utc(), device_id, user_id),
            )
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not revoke device"}), 500

    return jsonify({"message": "Device revoked", "id": device_id}), 200
