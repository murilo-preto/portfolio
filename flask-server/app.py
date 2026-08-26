from flask import Flask, request, jsonify
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    jwt_required,
    get_jwt_identity,
    get_jwt,
    set_access_cookies,
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

import mysql.connector
from mysql.connector import Error
from mysql.connector.pooling import MySQLConnectionPool

from categories import normalize_category_name
from migrations import run_migrations
from itau_pdf import (
    ItauPdfError,
    extract_statement_from_bytes,
    statement_to_finance_entries,
)

from contextlib import contextmanager
import bcrypt
import os
import logging
import threading
import calendar
from datetime import date, datetime, timedelta, timezone

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_ACCESS_COOKIE_NAME"] = "access_token"
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(
    hours=int(os.getenv("TOKEN_DURATION_HOURS", "48"))
)

if not app.config["JWT_SECRET_KEY"]:
    raise RuntimeError("JWT_SECRET_KEY environment variable is not set")

# Statement PDFs are a few hundred KB; cap them well above that, and cap a
# whole multi-file upload well above that again. Flask rejects a request body
# larger than MAX_CONTENT_LENGTH before it reaches a route handler.
MAX_PDF_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_UPLOAD_COUNT = 24
MAX_BULK_DELETE_IDS = 500
MAX_GENERATE_ROWS = 1000
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

# Rate limiting — disabled when RATELIMIT_ENABLED=false (e.g. in tests)
_ratelimit_enabled = os.getenv("RATELIMIT_ENABLED", "true").lower() != "false"
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["100 per hour", "20 per minute"],
    storage_uri="memory://",
    enabled=_ratelimit_enabled,
)

jwt = JWTManager(app)

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
}

missing = [k for k, v in DB_CONFIG.items() if not v]
if missing:
    raise RuntimeError(f"Missing required DB environment variables: {missing}")

_pool = None
_pool_lock = threading.Lock()


def get_pool():
    """Return the connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = MySQLConnectionPool(
                    pool_name="time_tracker_pool", pool_size=5, **DB_CONFIG
                )
    return _pool


@contextmanager
def get_cursor(dictionary=True):
    """
    Context manager that acquires a pooled connection, yields a cursor,
    commits on success, rolls back on error, and always cleans up.

    Usage:
        with get_cursor() as cursor:
            cursor.execute(...)
    """
    connection = get_pool().get_connection()
    cursor = connection.cursor(dictionary=dictionary)
    try:
        yield cursor
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def normalize_existing_finance_categories():
    """Bring already-stored finance category names in line with
    normalize_category_name, so names created before normalization existed
    (all of them shouted, having come from statement PDFs) stop shouting.

    Idempotent and safe to run on every boot: a second pass finds nothing to
    do, and finance_entries reference categories by id, so renaming only
    changes the displayed name. Runs per gunicorn worker, hence the
    tolerance for a concurrent worker having renamed a row first.
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            rows = cursor.fetchall()

            renamed = 0
            for row in rows:
                normalized = normalize_category_name(row["name"])
                if normalized == row["name"]:
                    continue
                try:
                    cursor.execute(
                        "UPDATE finance_categories SET name = %s WHERE id = %s",
                        (normalized, row["id"]),
                    )
                    renamed += 1
                except Error as e:
                    # Only reachable if normalizing collapses two names onto
                    # one another; leave both alone rather than merging.
                    logger.warning(
                        f"Skipped renaming category {row['name']!r}: {e}"
                    )

        if renamed:
            logger.info(f"Normalized {renamed} finance category name(s)")

    except Error as e:
        # Never let a tidy-up keep the API from starting.
        logger.error(f"Could not normalize finance category names: {e}")


MAX_NOTE_LENGTH = 255


def clean_entry_note(raw):
    """Normalise an optional time-entry note.

    Blank in any form collapses to None, so "no note" is one value in the
    database rather than a mix of NULL and "". Raises ValueError with a
    caller-safe message, which the batch importer reports per row and the
    single-entry routes turn into a 400.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("note must be a string")
    note = raw.strip()
    if not note:
        return None
    if len(note) > MAX_NOTE_LENGTH:
        raise ValueError(f"note must be at most {MAX_NOTE_LENGTH} characters")
    return note


def retrieve_entry_from_username(username):
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    te.id,
                    c.name AS category,
                    te.start_time,
                    te.end_time,
                    te.note,
                    TIMESTAMPDIFF(SECOND, te.start_time, te.end_time) AS duration_seconds
                FROM time_entries te
                JOIN category c ON te.category_id = c.id
                WHERE te.user_id = %s
                ORDER BY te.start_time ASC
                """,
                (user["id"],),
            )
            entries = cursor.fetchall()

        return jsonify({"username": username, "entries": entries}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch entries"}), 500


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy"}), 200


@app.get("/protected")
@jwt_required()
def protected():
    current_user = get_jwt_identity()

    return jsonify(message="Access granted", user=current_user), 200


@app.after_request
def refresh_expiring_jwts(response):
    try:
        exp_timestamp = get_jwt()["exp"]
        now = datetime.now(timezone.utc)
        target_timestamp = datetime.timestamp(now + timedelta(hours=24))
        if target_timestamp > exp_timestamp:
            access_token = create_access_token(identity=get_jwt_identity())
            set_access_cookies(response, access_token)
        return response
    except (RuntimeError, KeyError):
        return response


@app.get("/entry")
@jwt_required()
def myentries():
    """
    Retrieves entries from a user from token username
    """

    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_entry_from_username(username)


@app.route("/get/categories", methods=["GET"])
def list_categories():
    """
    List all categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM category ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500


@app.route("/register", methods=["POST"])
@limiter.limit("5 per minute")
@limiter.limit("10 per hour")
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
        with get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (username, pwd_hash) VALUES (%s, %s)",
                (username, pwd_hash),
            )
            user_id = cursor.lastrowid

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


@app.route("/login", methods=["POST"])
@limiter.limit("10 per minute")
@limiter.limit("30 per hour")
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
        500: Server error
    """
    data = request.get_json()

    if not data or "username" not in data or "password" not in data:
        return jsonify({"error": "Username and password are required"}), 400

    username = data["username"].strip()
    password = data["password"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id, username, pwd_hash FROM users WHERE username = %s",
                (username,),
            )
            user = cursor.fetchone()
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Login failed"}), 500

    if not user:
        return jsonify({"error": "Invalid username or password"}), 401

    stored_hash = bytes(user["pwd_hash"])

    if bcrypt.checkpw(password.encode("utf-8"), stored_hash):
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
    else:
        return jsonify({"error": "Invalid username or password"}), 401


@app.route("/category", methods=["POST"])
@jwt_required()
def create_category():
    """
    Create a new category if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Category created
        200: Category already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Category name is required"}), 400

    name = data["name"].strip()

    if not name or len(name) > 100:
        return jsonify(
            {"error": "Category name must be between 1 and 100 characters"}
        ), 400

    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM category WHERE name = %s", (name,))
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute("INSERT INTO category (name) VALUES (%s)", (name,))
            category_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Category created successfully",
                "category": {"id": category_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create category"}), 500


@app.route("/entry/create", methods=["POST"])
@jwt_required()
def create_time_entry():
    """
    Create a new time entry.

    Expected JSON:
    {
        "username": "string",
        "category": "string",
        "start_time": "YYYY-MM-DD HH:MM:SS",
        "end_time": "YYYY-MM-DD HH:MM:SS",
        "note": "string" (optional, max 255 chars)
    }

    Returns:
        201: Entry created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    data = request.get_json()

    username = get_jwt_identity()
    required_fields = ["category", "start_time", "end_time"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "category, start_time and end_time are required"}
        ), 400
    category_name = data["category"].strip()
    start_time_str = data["start_time"]
    end_time_str = data["end_time"]

    try:
        note = clean_entry_note(data.get("note"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

        if start_time.tzinfo is None or end_time.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400

        start_time = start_time.astimezone(timezone.utc)
        end_time = end_time.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    if end_time <= start_time:
        return jsonify({"error": "end_time must be after start_time"}), 400

    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute("SELECT id FROM category WHERE name = %s", (category_name,))
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], start_time, end_time, note),
            )
            entry_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Time entry created successfully",
                "entry": {
                    "id": entry_id,
                    "username": username,
                    "category": category_name,
                    "start_time": start_time_str,
                    "end_time": end_time_str,
                    "note": note,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create time entry"}), 500


@app.route("/entry/<int:entry_id>", methods=["PUT"])
@jwt_required()
def update_time_entry(entry_id):
    """
    Update an existing time entry.

    Expected JSON:
    {
        "category": "string",
        "start_time": "YYYY-MM-DD HH:MM:SS",
        "end_time": "YYYY-MM-DD HH:MM:SS",
        "note": "string" (optional, max 255 chars)
    }

    Omitting "note" leaves the stored note untouched; sending it null or blank
    clears it. A client that predates notes therefore cannot wipe one just by
    round-tripping an entry.

    Returns:
        200: Entry updated
        400: Validation error
        403: Not owner of entry
        404: Entry or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    category_name = data.get("category", "").strip()
    start_time_str = data.get("start_time")
    end_time_str = data.get("end_time")

    if not category_name or not start_time_str or not end_time_str:
        return jsonify({"error": "category, start_time and end_time are required"}), 400

    note_provided = "note" in data
    note = None
    if note_provided:
        try:
            note = clean_entry_note(data["note"])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    try:
        start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

        if start_time.tzinfo is None or end_time.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400

        start_time = start_time.astimezone(timezone.utc)
        end_time = end_time.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    if end_time <= start_time:
        return jsonify({"error": "end_time must be after start_time"}), 400

    try:
        with get_cursor() as cursor:
            # Verify entry belongs to this user
            cursor.execute(
                """
                SELECT te.id FROM time_entries te
                JOIN users u ON te.user_id = u.id
                WHERE te.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            # Resolve category
            cursor.execute("SELECT id FROM category WHERE name = %s", (category_name,))
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            assignments = ["category_id = %s", "start_time = %s", "end_time = %s"]
            values = [category["id"], start_time, end_time]
            if note_provided:
                assignments.append("note = %s")
                values.append(note)
            values.append(entry_id)

            cursor.execute(
                f"UPDATE time_entries SET {', '.join(assignments)} WHERE id = %s",
                tuple(values),
            )

        return jsonify({"message": "Entry updated successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update entry"}), 500


@app.route("/entry/delete", methods=["DELETE"])
@jwt_required()
def delete_time_entry():
    """
    Delete a time entry by entry_id.

    Expects JSON:
    {
        "entry_id": int
    }

    Returns:
        200: Entry deleted
        400: Validation error
        403: Not owner of entry
        404: Entry not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entry_id" not in data:
        return jsonify({"error": "entry_id is required"}), 400

    entry_id = data["entry_id"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT te.id FROM time_entries te
                JOIN users u ON te.user_id = u.id
                WHERE te.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            cursor.execute("DELETE FROM time_entries WHERE id = %s", (entry_id,))

        return jsonify({"message": "Entry deleted successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete entry"}), 500


@app.route("/entry/batch-import", methods=["POST"])
@jwt_required()
def batch_import_time_entries():
    """
    Batch import multiple time entries from a single request.

    Expected JSON:
    {
        "entries": [
            {
                "category": "string",
                "start_time": "YYYY-MM-DD HH:MM:SS",
                "end_time": "YYYY-MM-DD HH:MM:SS",
                "note": "string" (optional, max 255 chars)
            },
            ...
        ]
    }

    Returns:
        200: { success: number, failed: number, errors: Array<{index, error}> }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entries" not in data:
        return jsonify({"error": "entries array is required"}), 400

    entries = data["entries"]
    if not isinstance(entries, list):
        return jsonify({"error": "entries must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}

    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404
        user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    # First, get or create all categories
    category_cache = {}
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM category")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"]] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    for i, entry in enumerate(entries):
        try:
            category_name = entry.get("category", "").strip()
            start_time_str = entry.get("start_time")
            end_time_str = entry.get("end_time")

            if not category_name or not start_time_str or not end_time_str:
                raise ValueError("category, start_time and end_time are required")

            note = clean_entry_note(entry.get("note"))

            # Parse and validate dates
            start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

            if start_time.tzinfo is None or end_time.tzinfo is None:
                raise ValueError("Timezone information required")

            start_time = start_time.astimezone(timezone.utc)
            end_time = end_time.astimezone(timezone.utc)

            if end_time <= start_time:
                raise ValueError("end_time must be after start_time")

            # Get or create category
            if category_name not in category_cache:
                with get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO category (name) VALUES (%s)",
                        (category_name,)
                    )
                    category_cache[category_name] = cursor.lastrowid

            category_id = category_cache[category_name]

            with get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, start_time, end_time, note)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to import entry {i}: {e}")

    return jsonify(results), 200


# ─── Finance Routes ────────────────────────────────────────────────────────────


def retrieve_finance_entries_from_username(username):
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    fe.id,
                    fc.name AS category,
                    fe.product_name,
                    fe.price,
                    fe.purchase_date,
                    fe.status
                FROM finance_entries fe
                JOIN finance_categories fc ON fe.category_id = fc.id
                WHERE fe.user_id = %s
                ORDER BY fe.purchase_date DESC
                """,
                (user["id"],),
            )
            entries = cursor.fetchall()

            # Convert Decimal to float for JSON serialization
            for entry in entries:
                if entry["price"] is not None:
                    entry["price"] = float(entry["price"])

        return jsonify({"username": username, "entries": entries}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch finance entries"}), 500


@app.get("/finance")
@jwt_required()
def my_finance_entries():
    """
    Retrieves finance entries from a user from token username
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_finance_entries_from_username(username)


@app.route("/finance/categories", methods=["GET"])
def list_finance_categories():
    """
    List all finance categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch finance categories"}), 500


@app.route("/finance/category", methods=["POST"])
@jwt_required()
def create_finance_category():
    """
    Create a new finance category if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Category created
        200: Category already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Category name is required"}), 400

    name = normalize_category_name(data["name"].strip())

    if not name or len(name) > 100:
        return jsonify(
            {"error": "Category name must be between 1 and 100 characters"}
        ), 400

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id, name FROM finance_categories WHERE name = %s", (name,)
            )
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute(
                "INSERT INTO finance_categories (name) VALUES (%s)", (name,)
            )
            category_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Category created successfully",
                "category": {"id": category_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create finance category"}), 500


@app.route("/finance/create", methods=["POST"])
@jwt_required()
def create_finance_entry():
    """
    Create a new finance entry.

    Expected JSON:
    {
        "product_name": "string",
        "category": "string",
        "price": number,
        "purchase_date": "YYYY-MM-DD HH:MM:SS",
        "status": "planned" | "done" (optional, defaults to "planned")
    }

    Returns:
        201: Entry created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    required_fields = ["product_name", "category", "price", "purchase_date"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "product_name, category, price and purchase_date are required"}
        ), 400

    product_name = data["product_name"].strip()
    category_name = data["category"].strip()
    price = data["price"]
    purchase_date_str = data["purchase_date"]
    status = data.get("status", "planned")

    if not product_name or len(product_name) > 255:
        return jsonify(
            {"error": "Product name must be between 1 and 255 characters"}
        ), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "Status must be 'planned' or 'done'"}), 400

    try:
        price_value = float(price)
        if price_value < 0:
            return jsonify({"error": "Price must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Price must be a valid number"}), 400

    try:
        purchase_date = datetime.fromisoformat(
            purchase_date_str.replace("Z", "+00:00")
        )
        if purchase_date.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400
        purchase_date = purchase_date.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                "SELECT id FROM finance_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], product_name, price_value, purchase_date, status),
            )
            entry_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Finance entry created successfully",
                "entry": {
                    "id": entry_id,
                    "product_name": product_name,
                    "category": category_name,
                    "price": price_value,
                    "purchase_date": purchase_date_str,
                    "status": status,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create finance entry"}), 500


@app.route("/finance/<int:entry_id>", methods=["PUT"])
@jwt_required()
def update_finance_entry(entry_id):
    """
    Update an existing finance entry.

    Expected JSON:
    {
        "product_name": "string",
        "category": "string",
        "price": number,
        "purchase_date": "YYYY-MM-DD HH:MM:SS",
        "status": "planned" | "done"
    }

    Returns:
        200: Entry updated
        400: Validation error
        403: Not owner of entry
        404: Entry or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    product_name = data.get("product_name", "").strip()
    category_name = data.get("category", "").strip()
    price = data.get("price")
    purchase_date_str = data.get("purchase_date")
    status = data.get("status", "planned")

    if not product_name or not category_name or not purchase_date_str:
        return jsonify(
            {"error": "product_name, category and purchase_date are required"}
        ), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "Status must be 'planned' or 'done'"}), 400

    try:
        price_value = float(price) if price is not None else None
        if price_value is not None and price_value < 0:
            return jsonify({"error": "Price must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Price must be a valid number"}), 400

    try:
        purchase_date = datetime.fromisoformat(
            purchase_date_str.replace("Z", "+00:00")
        )
        if purchase_date.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400
        purchase_date = purchase_date.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    try:
        with get_cursor() as cursor:
            # Verify entry belongs to this user
            cursor.execute(
                """
                SELECT fe.id FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE fe.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            # Resolve category
            cursor.execute(
                "SELECT id FROM finance_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                UPDATE finance_entries
                SET category_id = %s, product_name = %s, price = %s, purchase_date = %s, status = %s
                WHERE id = %s
                """,
                (category["id"], product_name, price_value, purchase_date, status, entry_id),
            )

        return jsonify({"message": "Finance entry updated successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update finance entry"}), 500


@app.route("/finance/delete", methods=["POST"])
@jwt_required()
def delete_finance_entry():
    """
    Delete a finance entry by entry_id.

    Expects JSON:
    {
        "entry_id": int
    }

    Returns:
        200: Entry deleted
        400: Validation error
        403: Not owner of entry
        404: Entry not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entry_id" not in data:
        return jsonify({"error": "entry_id is required"}), 400

    entry_id = data["entry_id"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT fe.id FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE fe.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            cursor.execute("DELETE FROM finance_entries WHERE id = %s", (entry_id,))

        return jsonify({"message": "Finance entry deleted successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete finance entry"}), 500


@app.route("/finance/bulk-delete", methods=["POST"])
@jwt_required()
def bulk_delete_finance_entries():
    """
    Delete several finance entries in one request.

    Expects JSON:
    {
        "entry_ids": [int, ...]
    }

    Ownership is enforced inside the DELETE itself, so ids belonging to another
    user are simply not matched. The response reports how many rows actually
    went, without revealing which of the others exist.

    Returns:
        200: { deleted: int, requested: int }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entry_ids" not in data:
        return jsonify({"error": "entry_ids is required"}), 400

    entry_ids = data["entry_ids"]

    if not isinstance(entry_ids, list) or not entry_ids:
        return jsonify({"error": "entry_ids must be a non-empty array"}), 400

    if len(entry_ids) > MAX_BULK_DELETE_IDS:
        return jsonify({
            "error": f"Too many entries (max {MAX_BULK_DELETE_IDS} at a time)"
        }), 400

    try:
        ids = [int(entry_id) for entry_id in entry_ids]
    except (TypeError, ValueError):
        return jsonify({"error": "entry_ids must all be integers"}), 400

    placeholders = ", ".join(["%s"] * len(ids))

    try:
        with get_cursor() as cursor:
            cursor.execute(
                f"""
                DELETE fe FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE u.username = %s AND fe.id IN ({placeholders})
                """,
                (current_user, *ids),
            )
            deleted = cursor.rowcount

        return jsonify({"deleted": deleted, "requested": len(ids)}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete finance entries"}), 500


@app.route("/finance/batch-import", methods=["POST"])
@jwt_required()
def batch_import_finance_entries():
    """
    Batch import multiple finance entries from a single request.

    Expected JSON:
    {
        "entries": [
            {
                "category": "string",
                "product_name": "string",
                "price": number,
                "purchase_date": "YYYY-MM-DD HH:MM:SS",
                "status": "planned" | "done" (optional, defaults to "planned")
            },
            ...
        ]
    }

    Returns:
        200: { success: number, failed: number, errors: Array<{index, error}> }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entries" not in data:
        return jsonify({"error": "entries array is required"}), 400

    entries = data["entries"]
    if not isinstance(entries, list):
        return jsonify({"error": "entries must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}

    # First, get or create all finance categories. The cache is keyed by
    # casefolded name because finance_categories.name is uniquely indexed with
    # a case-insensitive collation — looking up case-sensitively would miss an
    # existing "Food" for an incoming "FOOD" and then fail on a duplicate key.
    category_cache = {}
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"].casefold()] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    # Get user ID once
    user_id = None
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
            if user:
                user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    if not user_id:
        return jsonify({"error": "User not found"}), 404

    for i, entry in enumerate(entries):
        try:
            category_name = entry.get("category", "").strip()
            product_name = entry.get("product_name", "").strip()
            price = entry.get("price")
            purchase_date_str = entry.get("purchase_date")
            status = entry.get("status", "planned")

            if not category_name or not product_name or not purchase_date_str:
                raise ValueError("category, product_name and purchase_date are required")

            # Validate price
            price_value = float(price)
            if price_value < 0:
                raise ValueError("Price must be non-negative")

            # Validate status
            if status not in ("planned", "done"):
                raise ValueError("Status must be 'planned' or 'done'")

            # Parse and validate date
            purchase_date = datetime.fromisoformat(purchase_date_str.replace("Z", "+00:00"))
            if purchase_date.tzinfo is None:
                raise ValueError("Timezone information required")
            purchase_date = purchase_date.astimezone(timezone.utc)

            # Get or create category. A name that is not on record yet is
            # normalized first, so an imported "ALIMENTAÇÃO" is stored as
            # "Alimentação"; one that already exists keeps its stored spelling.
            category_key = category_name.casefold()
            if category_key not in category_cache:
                with get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (normalize_category_name(category_name),)
                    )
                    category_cache[category_key] = cursor.lastrowid

            category_id = category_cache[category_key]

            # Insert finance entry
            with get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, product_name, price_value, purchase_date, status)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to import finance entry {i}: {e}")

    return jsonify(results), 200


# ─── Finance Bulk Generator ────────────────────────────────────────────────────


def _last_day_of_month(year, month):
    """Return the number of days in a given month (28/29 for February)."""
    return calendar.monthrange(year, month)[1]


def _clamped_generation_day(year, month, day):
    """Resolve a requested day-of-month to an actual day, clamping to the last
    day of the month when it is shorter (e.g. day 31 in April -> 30). A day of
    -1 explicitly means the last day of the month."""
    if day == -1:
        return _last_day_of_month(year, month)
    return min(day, _last_day_of_month(year, month))


def _generate_occurrence_dates(frequency, day, start_date, end_date):
    """Compute the occurrence dates in [start_date, end_date] for a day-of-month
    frequency (monthly / quarterly / yearly), anchored on the start date's
    month. Occurrences whose date falls outside the window are dropped."""
    step = {"monthly": 1, "quarterly": 3, "yearly": 12}[frequency]
    anchor = start_date.year * 12 + (start_date.month - 1)
    dates = []
    cursor = anchor
    while True:
        year, month = divmod(cursor, 12)
        month += 1
        occurrence = date(year, month, _clamped_generation_day(year, month, day))
        if occurrence > end_date:
            break
        if occurrence >= start_date:
            dates.append(occurrence)
        cursor += step
    return dates


@app.route("/finance/batch-generate", methods=["POST"])
@jwt_required()
def batch_generate_finance_entries():
    """
    Generate finance entries from a schedule: a frequency plus a day-of-month,
    applied across a date range to every entry template in one go.

    Expected JSON:
    {
        "frequency": "monthly" | "quarterly" | "yearly",
        "day": int,                 # 1-31, or -1 for the last day of the month
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD",
        "status": "planned" | "done" (optional, defaults to "planned"),
        "entries": [
            { "category": "string", "product_name": "string", "price": number },
            ...
        ],
        "preview": bool (optional, defaults to false),
        "utc_offset_minutes": int (optional, defaults to 0)
    }

    `utc_offset_minutes` is the client's current UTC offset (new
    Date().getTimezoneOffset()) so the stored timestamp keeps each entry on the
    picked day when displayed back in the same timezone.

    With preview=true no rows are written; the response contains every row that
    would be created. Otherwise the rows are inserted and per-row errors are
    collected like /finance/batch-import.

    Returns:
        200: { preview, count, rows } or { success, failed, errors }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    frequency = data.get("frequency")
    day = data.get("day")
    start_date_str = data.get("start_date")
    end_date_str = data.get("end_date")
    status = data.get("status", "planned")
    entries = data.get("entries")
    preview = bool(data.get("preview", False))
    utc_offset_minutes = data.get("utc_offset_minutes", 0)

    valid_frequencies = ("monthly", "quarterly", "yearly")
    if frequency not in valid_frequencies:
        return jsonify(
            {"error": f"frequency must be one of: {', '.join(valid_frequencies)}"}
        ), 400

    try:
        day_value = int(day)
        if day_value == -1:
            pass
        elif not 1 <= day_value <= 31:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "day must be an integer between 1 and 31, or -1 for the last day of the month"}), 400

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return jsonify({"error": "start_date and end_date must be in YYYY-MM-DD format"}), 400

    if end_date < start_date:
        return jsonify({"error": "end_date must be on or after start_date"}), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "status must be 'planned' or 'done'"}), 400

    if not isinstance(entries, list) or not entries:
        return jsonify({"error": "entries must be a non-empty array"}), 400

    normalized_entries = []
    for entry in entries:
        category_name = entry.get("category", "").strip()
        product_name = entry.get("product_name", "").strip()
        if not category_name or not product_name:
            return jsonify({"error": "each entry needs a category and a product_name"}), 400
        try:
            price_value = float(entry.get("price"))
            if price_value < 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": f"price for '{product_name}' must be a non-negative number"}), 400
        normalized_entries.append((category_name, product_name, price_value))

    occurrence_dates = _generate_occurrence_dates(
        frequency, day_value, start_date, end_date
    )
    if not occurrence_dates:
        return jsonify(
            {"error": "No occurrences fall inside the selected date range"}
        ), 400

    try:
        utc_offset = int(utc_offset_minutes)
    except (TypeError, ValueError):
        return jsonify({"error": "utc_offset_minutes must be an integer"}), 400

    generated_rows = []
    for occurrence in occurrence_dates:
        purchase_date = datetime.combine(
            occurrence, datetime.min.time()
        ) + timedelta(minutes=utc_offset)
        for category_name, product_name, price_value in normalized_entries:
            generated_rows.append({
                "category": category_name,
                "product_name": product_name,
                "price": price_value,
                "purchase_date": purchase_date,
            })

    if len(generated_rows) > MAX_GENERATE_ROWS:
        return jsonify({
            "error": f"This schedule would create {len(generated_rows)} entries (max {MAX_GENERATE_ROWS})"
        }), 400

    if preview:
        return jsonify({
            "preview": True,
            "count": len(generated_rows),
            "rows": [
                {
                    "category": row["category"],
                    "product_name": row["product_name"],
                    "price": row["price"],
                    "purchase_date": row["purchase_date"].isoformat(),
                }
                for row in generated_rows
            ],
        }), 200

    # Get or create all finance categories. The cache is keyed by casefolded
    # name because finance_categories.name is uniquely indexed with a
    # case-insensitive collation (see /finance/batch-import).
    category_cache = {}
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"].casefold()] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    user_id = None
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
            if user:
                user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    if not user_id:
        return jsonify({"error": "User not found"}), 404

    results = {"success": 0, "failed": 0, "errors": []}

    for i, row in enumerate(generated_rows):
        try:
            category_key = row["category"].casefold()
            if category_key not in category_cache:
                with get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (normalize_category_name(row["category"]),)
                    )
                    category_cache[category_key] = cursor.lastrowid

            category_id = category_cache[category_key]

            with get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, row["product_name"], row["price"], row["purchase_date"], status)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to generate finance entry {i}: {e}")

    return jsonify(results), 200


@app.route("/finance/parse-itau-pdf", methods=["POST"])
@jwt_required()
def parse_itau_pdf():
    """
    Parse one or more uploaded Itau credit card statement PDFs into finance
    entries.

    This endpoint only reads the PDFs — nothing is written to the database. The
    client previews the result and then posts the entries it wants to
    /finance/batch-import, which is where the actual insert happens.

    Each file is parsed independently so that one unreadable PDF does not sink
    the rest of the batch; its failure is reported in `failures` instead.

    Expected: multipart/form-data with one or more "file" fields holding PDFs.

    Returns:
        200: {
            statements: [{ file, issued_on, due_on, cards, total, reconciled,
                           entry_count, skipped_count }],
            failures: [{ file, error }],
            entries: [{ category, product_name, price, purchase_date, status,
                        card, file }],
            skipped: [{ ..., reason }]
        }
        400: No files at all, or too many files
        500: Server error
    """
    uploads = [f for f in request.files.getlist("file") if f and f.filename]
    if not uploads:
        return jsonify({"error": "At least one PDF file is required"}), 400

    if len(uploads) > MAX_PDF_UPLOAD_COUNT:
        return jsonify({
            "error": f"Too many files (max {MAX_PDF_UPLOAD_COUNT} at a time)"
        }), 400

    statements = []
    failures = []
    all_entries = []
    all_skipped = []
    # An Itau statement is uniquely identified by its issue date, so the same
    # statement downloaded twice under different filenames is caught here
    # rather than silently importing every transaction on it twice.
    seen_issue_dates = {}

    for uploaded in uploads:
        filename = uploaded.filename
        try:
            pdf_bytes = uploaded.read()
            if len(pdf_bytes) > MAX_PDF_UPLOAD_BYTES:
                raise ItauPdfError("PDF is too large (max 10 MB)")

            statement = extract_statement_from_bytes(pdf_bytes, filename)
        except ItauPdfError as e:
            failures.append({"file": filename, "error": str(e)})
            continue
        except Exception as e:
            logger.error(f"Failed to parse Itau PDF {filename}: {e}")
            failures.append({"file": filename, "error": "Failed to parse the PDF"})
            continue

        issued_on = statement["emissao"]
        if issued_on in seen_issue_dates:
            failures.append({
                "file": filename,
                "error": (
                    f"Same statement as {seen_issue_dates[issued_on]} "
                    f"(both issued {issued_on}) — skipped to avoid duplicates"
                ),
            })
            continue
        seen_issue_dates[issued_on] = filename

        entries, skipped = statement_to_finance_entries(statement)
        for row in entries:
            row["file"] = filename
        for row in skipped:
            row["file"] = filename

        all_entries.extend(entries)
        all_skipped.extend(skipped)
        statements.append({
            "file": filename,
            "issued_on": issued_on,
            "due_on": statement["vencimento"],
            "cards": sorted(statement["titulares"].keys()),
            "total": statement["resumo"]["total_lancamentos"],
            # False means the transactions we read do not add up to the totals
            # printed on the statement, i.e. the parse likely missed something.
            "reconciled": statement["resumo"]["conferido"],
            "entry_count": len(entries),
            "skipped_count": len(skipped),
        })

    statements.sort(key=lambda s: s["issued_on"])
    all_entries.sort(key=lambda e: e["purchase_date"])
    all_skipped.sort(key=lambda e: e["purchase_date"])

    return jsonify({
        "statements": statements,
        "failures": failures,
        "entries": all_entries,
        "skipped": all_skipped,
    }), 200


@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify(error="Missing or invalid token"), 401


@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify(error="Invalid token"), 401


@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify(error="Token expired"), 401


# ─── TODO Routes ──────────────────────────────────────────────────────────────


def _next_recurrence_date(dt, rule):
    """Compute the next occurrence of dt for a given recurrence rule."""
    if rule == "daily":
        return dt + timedelta(days=1)
    if rule == "weekly":
        return dt + timedelta(weeks=1)
    if rule == "monthly":
        year = dt.year + (dt.month // 12)
        month = dt.month % 12 + 1
        day = min(dt.day, calendar.monthrange(year, month)[1])
        return dt.replace(year=year, month=month, day=day)
    return dt


def _resolve_or_create_tag_ids(cursor, tag_names):
    """Get-or-create each tag name and return their ids."""
    tag_ids = []
    for raw_name in tag_names:
        name = (raw_name or "").strip()
        if not name or len(name) > 50:
            continue
        cursor.execute("SELECT id FROM todo_tags WHERE name = %s", (name,))
        tag = cursor.fetchone()
        if not tag:
            cursor.execute("INSERT INTO todo_tags (name) VALUES (%s)", (name,))
            tag_id = cursor.lastrowid
        else:
            tag_id = tag["id"]
        tag_ids.append(tag_id)
    return tag_ids


def _set_todo_item_tags(cursor, item_id, tag_ids):
    """Replace the tag set for a TODO item."""
    cursor.execute("DELETE FROM todo_item_tags WHERE todo_id = %s", (item_id,))
    for tag_id in tag_ids:
        cursor.execute(
            "INSERT IGNORE INTO todo_item_tags (todo_id, tag_id) VALUES (%s, %s)",
            (item_id, tag_id),
        )


def _copy_todo_item_tags(cursor, from_item_id, to_item_id):
    cursor.execute(
        "SELECT tag_id FROM todo_item_tags WHERE todo_id = %s", (from_item_id,)
    )
    tag_ids = [row["tag_id"] for row in cursor.fetchall()]
    _set_todo_item_tags(cursor, to_item_id, tag_ids)


def _spawn_next_recurrence(cursor, item):
    """
    When a recurring TODO item is completed, insert its next occurrence.
    `item` must contain: user_id, category_id, title, description, priority,
    recurrence_rule, due_date, id.
    No-op if recurrence_rule is 'none', due_date is not set, or this item has
    already spawned an occurrence before (e.g. it was un-completed and
    completed again) — each occurrence spawns its successor at most once.
    """
    if item["recurrence_rule"] == "none" or item["due_date"] is None:
        return

    cursor.execute(
        "SELECT id FROM todo_items WHERE recurrence_parent_id = %s LIMIT 1",
        (item["id"],),
    )
    if cursor.fetchone():
        return

    next_due = _next_recurrence_date(item["due_date"], item["recurrence_rule"])

    cursor.execute(
        """
        INSERT INTO todo_items
            (user_id, category_id, title, description, priority, status,
             due_date, recurrence_rule, recurrence_parent_id)
        VALUES (%s, %s, %s, %s, %s, 'pending', %s, %s, %s)
        """,
        (
            item["user_id"],
            item["category_id"],
            item["title"],
            item["description"],
            item["priority"],
            next_due,
            item["recurrence_rule"],
            item["id"],
        ),
    )
    new_item_id = cursor.lastrowid
    _copy_todo_item_tags(cursor, item["id"], new_item_id)


def retrieve_todo_items_from_username(username):
    """Helper function to fetch TODO items for a user."""
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    ti.id,
                    fc.name AS category,
                    ti.title,
                    ti.description,
                    ti.priority,
                    ti.status,
                    ti.due_date,
                    ti.recurrence_rule,
                    ti.recurrence_parent_id,
                    ti.completed_at,
                    ti.created_at,
                    ti.updated_at
                FROM todo_items ti
                JOIN todo_categories fc ON ti.category_id = fc.id
                WHERE ti.user_id = %s
                ORDER BY
                    CASE ti.priority
                        WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2
                        WHEN 'low' THEN 3
                    END,
                    ti.due_date ASC,
                    ti.created_at DESC
                """,
                (user["id"],),
            )
            items = cursor.fetchall()

            # Attach tags per item (single grouped query, no N+1)
            tags_by_item = {item["id"]: [] for item in items}
            if items:
                item_ids = list(tags_by_item.keys())
                placeholders = ", ".join(["%s"] * len(item_ids))
                cursor.execute(
                    f"""
                    SELECT tit.todo_id, tt.id, tt.name
                    FROM todo_item_tags tit
                    JOIN todo_tags tt ON tit.tag_id = tt.id
                    WHERE tit.todo_id IN ({placeholders})
                    ORDER BY tt.name
                    """,
                    item_ids,
                )
                for row in cursor.fetchall():
                    tags_by_item[row["todo_id"]].append(
                        {"id": row["id"], "name": row["name"]}
                    )

            # Convert datetime objects to strings
            for item in items:
                for field in ["due_date", "completed_at", "created_at", "updated_at"]:
                    if item[field] is not None:
                        item[field] = item[field].isoformat()
                item["tags"] = tags_by_item[item["id"]]

        return jsonify({"username": username, "items": items}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO items"}), 500


@app.get("/todo")
@jwt_required()
def my_todo_items():
    """
    Retrieves TODO items from a user from token username
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_todo_items_from_username(username)


@app.route("/todo/categories", methods=["GET"])
def list_todo_categories():
    """
    List all TODO categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_categories ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO categories"}), 500


@app.route("/todo/category", methods=["POST"])
@jwt_required()
def create_todo_category():
    """
    Create a new TODO category if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Category created
        200: Category already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Category name is required"}), 400

    name = data["name"].strip()

    if not name or len(name) > 100:
        return jsonify(
            {"error": "Category name must be between 1 and 100 characters"}
        ), 400

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id, name FROM todo_categories WHERE name = %s", (name,)
            )
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute(
                "INSERT INTO todo_categories (name) VALUES (%s)", (name,)
            )
            category_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Category created successfully",
                "category": {"id": category_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO category"}), 500


@app.route("/todo/tags", methods=["GET"])
def list_todo_tags():
    """
    List all TODO tags.

    Returns:
        200: List of tags
        500: Server error
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_tags ORDER BY name")
            tags = cursor.fetchall()

        return jsonify({"tags": tags}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO tags"}), 500


@app.route("/todo/tag", methods=["POST"])
@jwt_required()
def create_todo_tag():
    """
    Create a new TODO tag if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Tag created
        200: Tag already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Tag name is required"}), 400

    name = data["name"].strip()

    if not name or len(name) > 50:
        return jsonify(
            {"error": "Tag name must be between 1 and 50 characters"}
        ), 400

    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_tags WHERE name = %s", (name,))
            existing = cursor.fetchone()

            if existing:
                return jsonify({"message": "Tag already exists", "tag": existing}), 200

            cursor.execute("INSERT INTO todo_tags (name) VALUES (%s)", (name,))
            tag_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Tag created successfully",
                "tag": {"id": tag_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO tag"}), 500


@app.route("/todo/create", methods=["POST"])
@jwt_required()
def create_todo_item():
    """
    Create a new TODO item.

    Expected JSON:
    {
        "title": "string",
        "category": "string",
        "description": "string" (optional),
        "priority": "low" | "medium" | "high" (optional, default: "medium"),
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional),
        "recurrence_rule": "none" | "daily" | "weekly" | "monthly" (optional, default: "none"),
        "tags": ["string", ...] (optional)
    }

    Returns:
        201: TODO item created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    required_fields = ["title", "category"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "title and category are required"}
        ), 400

    title = data["title"].strip()
    category_name = data["category"].strip()
    description = data.get("description", "").strip()
    priority = data.get("priority", "medium")
    due_date_str = data.get("due_date")
    recurrence_rule = data.get("recurrence_rule", "none")
    tag_names = data.get("tags", [])

    if not title or len(title) > 255:
        return jsonify(
            {"error": "Title must be between 1 and 255 characters"}
        ), 400

    valid_priorities = ("low", "medium", "high")
    if priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    valid_recurrence_rules = ("none", "daily", "weekly", "monthly")
    if recurrence_rule not in valid_recurrence_rules:
        return jsonify(
            {"error": f"recurrence_rule must be one of: {', '.join(valid_recurrence_rules)}"}
        ), 400

    if not isinstance(tag_names, list):
        return jsonify({"error": "tags must be an array of strings"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                ), 400
            due_date = due_date.astimezone(timezone.utc)
        except ValueError:
            return jsonify({"error": "due_date must be ISO 8601 format with timezone"}), 400

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                "SELECT id FROM todo_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO todo_items
                    (user_id, category_id, title, description, priority, due_date, recurrence_rule)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user["id"],
                    category["id"],
                    title,
                    description,
                    priority,
                    due_date,
                    recurrence_rule,
                ),
            )
            item_id = cursor.lastrowid

            tag_ids = _resolve_or_create_tag_ids(cursor, tag_names)
            _set_todo_item_tags(cursor, item_id, tag_ids)

            created_tags = []
            if tag_ids:
                placeholders = ", ".join(["%s"] * len(tag_ids))
                cursor.execute(
                    f"SELECT id, name FROM todo_tags WHERE id IN ({placeholders}) ORDER BY name",
                    tag_ids,
                )
                created_tags = cursor.fetchall()

        return jsonify(
            {
                "message": "TODO item created successfully",
                "item": {
                    "id": item_id,
                    "title": title,
                    "category": category_name,
                    "description": description,
                    "priority": priority,
                    "due_date": due_date_str,
                    "recurrence_rule": recurrence_rule,
                    "recurrence_parent_id": None,
                    "tags": created_tags,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO item"}), 500


@app.route("/todo/<int:item_id>", methods=["PUT"])
@jwt_required()
def update_todo_item(item_id):
    """
    Update an existing TODO item.

    Expected JSON:
    {
        "title": "string" (optional),
        "category": "string" (optional),
        "description": "string" (optional),
        "priority": "low" | "medium" | "high" (optional),
        "status": "pending" | "in_progress" | "completed" (optional),
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional),
        "recurrence_rule": "none" | "daily" | "weekly" | "monthly" (optional),
        "tags": ["string", ...] (optional)
    }

    Returns:
        200: TODO item updated
        400: Validation error
        403: Not owner of item
        404: TODO item or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    title = data.get("title", "").strip()
    category_name = data.get("category", "").strip()
    description = data.get("description")
    priority = data.get("priority")
    status = data.get("status")
    due_date_str = data.get("due_date")
    recurrence_rule = data.get("recurrence_rule")
    tag_names = data.get("tags")

    valid_priorities = ("low", "medium", "high")
    if priority and priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    valid_statuses = ("pending", "in_progress", "completed")
    if status and status not in valid_statuses:
        return jsonify({"error": f"Status must be one of: {', '.join(valid_statuses)}"}), 400

    valid_recurrence_rules = ("none", "daily", "weekly", "monthly")
    if recurrence_rule and recurrence_rule not in valid_recurrence_rules:
        return jsonify(
            {"error": f"recurrence_rule must be one of: {', '.join(valid_recurrence_rules)}"}
        ), 400

    if tag_names is not None and not isinstance(tag_names, list):
        return jsonify({"error": "tags must be an array of strings"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                ), 400
            due_date = due_date.astimezone(timezone.utc)
        except ValueError:
            return jsonify({"error": "due_date must be ISO 8601 format with timezone"}), 400

    try:
        with get_cursor() as cursor:
            # Verify item belongs to this user, and fetch current state for
            # the recurrence-spawn decision below.
            cursor.execute(
                """
                SELECT ti.id, ti.user_id, ti.category_id, ti.title, ti.description,
                       ti.priority, ti.status, ti.due_date, ti.recurrence_rule
                FROM todo_items ti
                JOIN users u ON ti.user_id = u.id
                WHERE ti.id = %s AND u.username = %s
                """,
                (item_id, current_user),
            )
            item = cursor.fetchone()

            if not item:
                return jsonify({"error": "TODO item not found or access denied"}), 404

            previous_status = item["status"]

            # Resolve category if provided
            category_id = None
            if category_name:
                cursor.execute(
                    "SELECT id FROM todo_categories WHERE name = %s", (category_name,)
                )
                category = cursor.fetchone()

                if not category:
                    return jsonify({"error": "Category not found"}), 404
                category_id = category["id"]

            # Build dynamic update query
            updates = []
            values = []
            if title:
                updates.append("title = %s")
                values.append(title)
            if category_id:
                updates.append("category_id = %s")
                values.append(category_id)
            if description is not None:
                updates.append("description = %s")
                values.append(description)
            if priority:
                updates.append("priority = %s")
                values.append(priority)
            if status:
                updates.append("status = %s")
                values.append(status)
                if status == "completed":
                    updates.append("completed_at = %s")
                    values.append(datetime.now(timezone.utc))
                elif status in ("pending", "in_progress"):
                    updates.append("completed_at = %s")
                    values.append(None)
            if due_date is not None:
                updates.append("due_date = %s")
                values.append(due_date)
            if recurrence_rule is not None:
                updates.append("recurrence_rule = %s")
                values.append(recurrence_rule)

            if not updates and tag_names is None:
                return jsonify({"error": "No fields to update"}), 400

            if updates:
                values.append(item_id)
                query = f"UPDATE todo_items SET {', '.join(updates)} WHERE id = %s"
                cursor.execute(query, values)

            if tag_names is not None:
                tag_ids = _resolve_or_create_tag_ids(cursor, tag_names)
                _set_todo_item_tags(cursor, item_id, tag_ids)

            # Spawn the next occurrence only on a genuine pending/in_progress
            # -> completed transition, never on re-completion.
            if status == "completed" and previous_status != "completed":
                effective_rule = (
                    recurrence_rule if recurrence_rule is not None else item["recurrence_rule"]
                )
                effective_due_date = due_date if due_date is not None else item["due_date"]
                _spawn_next_recurrence(
                    cursor,
                    {
                        "id": item_id,
                        "user_id": item["user_id"],
                        "category_id": category_id or item["category_id"],
                        "title": title or item["title"],
                        "description": description if description is not None else item["description"],
                        "priority": priority or item["priority"],
                        "recurrence_rule": effective_rule,
                        "due_date": effective_due_date,
                    },
                )

        return jsonify({"message": "TODO item updated successfully", "id": item_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update TODO item"}), 500


@app.route("/todo/delete", methods=["POST"])
@jwt_required()
def delete_todo_item():
    """
    Delete a TODO item by item_id.

    Expects JSON:
    {
        "item_id": int
    }

    Returns:
        200: TODO item deleted
        400: Validation error
        403: Not owner of item
        404: TODO item not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "item_id" not in data:
        return jsonify({"error": "item_id is required"}), 400

    item_id = data["item_id"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT ti.id FROM todo_items ti
                JOIN users u ON ti.user_id = u.id
                WHERE ti.id = %s AND u.username = %s
                """,
                (item_id, current_user),
            )
            item = cursor.fetchone()

            if not item:
                return jsonify({"error": "TODO item not found or access denied"}), 404

            cursor.execute("DELETE FROM todo_items WHERE id = %s", (item_id,))

        return jsonify({"message": "TODO item deleted successfully", "id": item_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete TODO item"}), 500


@app.route("/todo/bulk-update", methods=["POST"])
@jwt_required()
def bulk_update_todo_items():
    """
    Bulk update TODO item statuses.

    Expected JSON:
    {
        "updates": [
            {"item_id": int, "status": "pending" | "in_progress" | "completed"},
            ...
        ]
    }

    Returns:
        200: { success: number, failed: number, errors: Array<{index, error}> }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "updates" not in data:
        return jsonify({"error": "updates array is required"}), 400

    updates = data["updates"]
    if not isinstance(updates, list):
        return jsonify({"error": "updates must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}
    valid_statuses = ("pending", "in_progress", "completed")

    for i, update in enumerate(updates):
        try:
            item_id = update.get("item_id")
            status = update.get("status")

            if not item_id or not status:
                raise ValueError("item_id and status are required")

            if status not in valid_statuses:
                raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")

            with get_cursor() as cursor:
                # Verify item belongs to this user
                cursor.execute(
                    """
                    SELECT ti.id, ti.user_id, ti.category_id, ti.title, ti.description,
                           ti.priority, ti.status, ti.due_date, ti.recurrence_rule
                    FROM todo_items ti
                    JOIN users u ON ti.user_id = u.id
                    WHERE ti.id = %s AND u.username = %s
                    """,
                    (item_id, current_user),
                )
                item = cursor.fetchone()

                if not item:
                    raise ValueError("TODO item not found or access denied")

                previous_status = item["status"]
                completed_at = datetime.now(timezone.utc) if status == "completed" else None

                cursor.execute(
                    """
                    UPDATE todo_items
                    SET status = %s, completed_at = %s
                    WHERE id = %s
                    """,
                    (status, completed_at, item_id),
                )

                if status == "completed" and previous_status != "completed":
                    _spawn_next_recurrence(cursor, item)

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to update TODO item {i}: {e}")

    return jsonify(results), 200


# ─── Pomodoro Routes ──────────────────────────────────────────────────────────


@app.route("/pomodoro/start", methods=["POST"])
@jwt_required()
def start_pomodoro_session():
    """
    Start a new Pomodoro session.

    Expected JSON:
    {
        "todo_id": int (optional),
        "session_type": "pomodoro" | "short_break" | "long_break" (optional, default: "pomodoro")
    }

    Returns:
        201: Session started with session_id
        400: Validation error
        404: User or TODO item not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json() or {}
    todo_id = data.get("todo_id")
    session_type = data.get("session_type", "pomodoro")

    valid_session_types = ("pomodoro", "short_break", "long_break")
    if session_type not in valid_session_types:
        return jsonify(
            {"error": f"session_type must be one of: {', '.join(valid_session_types)}"}
        ), 400

    try:
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            # Verify TODO item if provided
            if todo_id is not None:
                cursor.execute(
                    """
                    SELECT ti.id FROM todo_items ti
                    JOIN users u ON ti.user_id = u.id
                    WHERE ti.id = %s AND u.username = %s
                    """,
                    (todo_id, current_user),
                )
                todo = cursor.fetchone()

                if not todo:
                    return jsonify({"error": "TODO item not found or access denied"}), 404

            # Self-heal: no scheduler exists to sweep abandoned sessions, so
            # any session left dangling in 'in_progress' (refresh, tab close,
            # crash) is cancelled the next time this user starts a new one.
            cursor.execute(
                """
                UPDATE pomodoro_sessions
                SET status = 'cancelled'
                WHERE user_id = %s AND status = 'in_progress'
                """,
                (user["id"],),
            )

            # Create session record
            cursor.execute(
                """
                INSERT INTO pomodoro_sessions (user_id, todo_id, session_type, duration_seconds, status, session_date)
                VALUES (%s, %s, %s, 0, 'in_progress', %s)
                """,
                (user["id"], todo_id, session_type, datetime.now(timezone.utc)),
            )
            session_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Pomodoro session started",
                "session_id": session_id,
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to start Pomodoro session"}), 500


@app.route("/pomodoro/complete", methods=["POST"])
@jwt_required()
def complete_pomodoro_session():
    """
    Complete a Pomodoro session.

    Expected JSON:
    {
        "session_id": int,
        "duration_seconds": int
    }

    Returns:
        200: Session completed
        400: Validation error
        403: Not owner of session
        404: Session not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    session_id = data.get("session_id")
    duration_seconds = data.get("duration_seconds")

    if not session_id or duration_seconds is None:
        return jsonify({"error": "session_id and duration_seconds are required"}), 400

    try:
        duration_seconds = int(duration_seconds)
        if duration_seconds < 0:
            return jsonify({"error": "duration_seconds must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "duration_seconds must be an integer"}), 400

    try:
        with get_cursor() as cursor:
            # Verify session belongs to this user and is still in progress
            # (prevents double-completing an already-resolved session)
            cursor.execute(
                """
                SELECT ps.id FROM pomodoro_sessions ps
                JOIN users u ON ps.user_id = u.id
                WHERE ps.id = %s AND u.username = %s AND ps.status = 'in_progress'
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute(
                """
                UPDATE pomodoro_sessions
                SET duration_seconds = %s, status = 'completed'
                WHERE id = %s
                """,
                (duration_seconds, session_id),
            )

        return jsonify({"message": "Pomodoro session completed", "id": session_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to complete Pomodoro session"}), 500


@app.route("/pomodoro/cancel", methods=["POST"])
@jwt_required()
def cancel_pomodoro_session():
    """
    Cancel a Pomodoro session (soft-cancel, preserving history).

    Expected JSON:
    {
        "session_id": int
    }

    Returns:
        200: Session cancelled
        400: Validation error
        403: Not owner of session
        404: Session not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "session_id" not in data:
        return jsonify({"error": "session_id is required"}), 400

    session_id = data["session_id"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT ps.id FROM pomodoro_sessions ps
                JOIN users u ON ps.user_id = u.id
                WHERE ps.id = %s AND u.username = %s AND ps.status = 'in_progress'
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute(
                "UPDATE pomodoro_sessions SET status = 'cancelled' WHERE id = %s",
                (session_id,),
            )

        return jsonify({"message": "Pomodoro session cancelled", "id": session_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to cancel Pomodoro session"}), 500


def retrieve_pomodoro_sessions_from_username(username):
    """Helper function to fetch Pomodoro sessions for a user."""
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    ps.id,
                    ps.todo_id,
                    ti.title AS todo_title,
                    ps.session_type,
                    ps.duration_seconds,
                    ps.status,
                    ps.session_date,
                    ps.created_at
                FROM pomodoro_sessions ps
                LEFT JOIN todo_items ti ON ps.todo_id = ti.id
                WHERE ps.user_id = %s
                ORDER BY ps.session_date DESC
                LIMIT 100
                """,
                (user["id"],),
            )
            sessions = cursor.fetchall()

            # Convert datetime objects to strings
            for session in sessions:
                for field in ["session_date", "created_at"]:
                    if session[field] is not None:
                        session[field] = session[field].isoformat()

        return jsonify({"username": username, "sessions": sessions}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch Pomodoro sessions"}), 500


@app.get("/pomodoro/sessions")
@jwt_required()
def my_pomodoro_sessions():
    """
    Retrieves Pomodoro sessions from a user from token username
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_pomodoro_sessions_from_username(username)


@app.get("/pomodoro/stats")
@jwt_required()
def pomodoro_stats():
    """
    Get Pomodoro statistics for the current user.

    Returns:
        200: Statistics including total sessions, total time, today's sessions, etc.
        400: Username required
        500: Server error
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            user_id = user["id"]

            # Total focus (pomodoro) sessions
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                """,
                (user_id,),
            )
            total_stats = cursor.fetchone()

            # Today's focus sessions
            today = datetime.now(timezone.utc).date()
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                AND DATE(session_date) = %s
                """,
                (user_id, today),
            )
            today_stats = cursor.fetchone()

            # This week's focus sessions (last 7 days)
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                AND session_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                """,
                (user_id,),
            )
            week_stats = cursor.fetchone()

            # Today's break time (short + long breaks), kept separate so it
            # doesn't dilute the "focus time" numbers above
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed'
                AND session_type IN ('short_break', 'long_break')
                AND DATE(session_date) = %s
                """,
                (user_id, today),
            )
            break_stats = cursor.fetchone()

        return jsonify({
            "username": username,
            "stats": {
                "total": {
                    "sessions": total_stats["count"],
                    "total_seconds": int(total_stats["total_seconds"]),
                },
                "today": {
                    "sessions": today_stats["count"],
                    "total_seconds": int(today_stats["total_seconds"]),
                },
                "week": {
                    "sessions": week_stats["count"],
                    "total_seconds": int(week_stats["total_seconds"]),
                },
                "today_breaks": {
                    "sessions": break_stats["count"],
                    "total_seconds": int(break_stats["total_seconds"]),
                },
            },
        }), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch Pomodoro stats"}), 500


# Runs under gunicorn too, where there is no __main__. Compose only starts this
# service once MySQL reports healthy, so the pool is ready by now.
#
# Migrations come first: everything below, and every request handler, assumes an
# up-to-date schema. run_migrations raises rather than limping on, so a failure
# here stops the worker booting.
run_migrations(lambda: get_pool().get_connection())
normalize_existing_finance_categories()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 3000)),
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true",
    )
