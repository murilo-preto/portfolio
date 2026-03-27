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

from contextlib import contextmanager
import bcrypt
import os
import logging
from datetime import datetime, timedelta, timezone

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

# Rate limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["100 per hour", "20 per minute"],
    storage_uri="memory://",
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


def get_pool():
    """Return the connection pool, creating it on first call."""
    global _pool
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
def create_time_entry():
    """
    Create a new time entry.

    Expected JSON:
    {
        "username": "string",
        "category": "string",
        "start_time": "YYYY-MM-DD HH:MM:SS",
        "end_time": "YYYY-MM-DD HH:MM:SS"
    }

    Returns:
        201: Entry created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    data = request.get_json()

    required_fields = ["username", "category", "start_time", "end_time"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "username, category, start_time and end_time are required"}
        ), 400

    username = data["username"].strip()
    category_name = data["category"].strip()
    start_time_str = data["start_time"]
    end_time_str = data["end_time"]

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
                INSERT INTO time_entries (user_id, category_id, start_time, end_time)
                VALUES (%s, %s, %s, %s)
                """,
                (user["id"], category["id"], start_time, end_time),
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
        "end_time": "YYYY-MM-DD HH:MM:SS"
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

    category_name = data.get("category", "").strip()
    start_time_str = data.get("start_time")
    end_time_str = data.get("end_time")

    if not category_name or not start_time_str or not end_time_str:
        return jsonify({"error": "category, start_time and end_time are required"}), 400

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

            cursor.execute(
                """
                UPDATE time_entries
                SET category_id = %s, start_time = %s, end_time = %s
                WHERE id = %s
                """,
                (category["id"], start_time, end_time, entry_id),
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
                "end_time": "YYYY-MM-DD HH:MM:SS"
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

            # Get user ID
            with get_cursor() as cursor:
                cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
                user = cursor.fetchone()

                if not user:
                    raise ValueError("User not found")

                # Insert time entry
                cursor.execute(
                    """
                    INSERT INTO time_entries (user_id, category_id, start_time, end_time)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (user["id"], category_id, start_time, end_time)
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

    name = data["name"].strip()

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

    # First, get or create all finance categories
    category_cache = {}
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"]] = cat["id"]
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

            # Get or create category
            if category_name not in category_cache:
                with get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (category_name,)
                    )
                    category_cache[category_name] = cursor.lastrowid

            category_id = category_cache[category_name]

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


@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify(error="Missing or invalid token"), 401


@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify(error="Invalid token"), 401


@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify(error="Token expired"), 401


# ─── Recurring Expense Routes ──────────────────────────────────────────────────


def retrieve_recurring_expenses_from_username(username):
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    re.id,
                    fc.name AS category,
                    re.name,
                    re.amount,
                    re.frequency,
                    re.start_date,
                    re.end_date,
                    re.is_active,
                    re.next_payment_date,
                    re.created_at,
                    re.updated_at
                FROM recurring_expenses re
                JOIN finance_categories fc ON re.category_id = fc.id
                WHERE re.user_id = %s
                ORDER BY re.is_active DESC, re.next_payment_date ASC
                """,
                (user["id"],),
            )
            expenses = cursor.fetchall()

            # Convert Decimal to float for JSON serialization
            for expense in expenses:
                if expense["amount"] is not None:
                    expense["amount"] = float(expense["amount"])
                # Convert date objects to strings
                for field in ["start_date", "end_date", "next_payment_date", "created_at", "updated_at"]:
                    if expense[field] is not None:
                        expense[field] = expense[field].isoformat()

        return jsonify({"username": username, "expenses": expenses}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch recurring expenses"}), 500


@app.get("/recurring-expenses")
@jwt_required()
def my_recurring_expenses():
    """
    Retrieves recurring expenses from a user from token username
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_recurring_expenses_from_username(username)


@app.route("/recurring-expenses/create", methods=["POST"])
@jwt_required()
def create_recurring_expense():
    """
    Create a new recurring expense.

    Expected JSON:
    {
        "name": "string",
        "category": "string",
        "amount": number,
        "frequency": "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD" (optional),
        "next_payment_date": "YYYY-MM-DD" (optional)
    }

    Returns:
        201: Expense created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    required_fields = ["name", "category", "amount", "frequency", "start_date"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "name, category, amount, frequency and start_date are required"}
        ), 400

    name = data["name"].strip()
    category_name = data["category"].strip()
    amount = data["amount"]
    frequency = data["frequency"]
    start_date_str = data["start_date"]
    end_date_str = data.get("end_date")
    next_payment_date_str = data.get("next_payment_date")

    valid_frequencies = ("weekly", "biweekly", "monthly", "quarterly", "yearly")
    if frequency not in valid_frequencies:
        return jsonify({"error": f"Frequency must be one of: {', '.join(valid_frequencies)}"}), 400

    try:
        amount_value = float(amount)
        if amount_value < 0:
            return jsonify({"error": "Amount must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Amount must be a valid number"}), 400

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "start_date must be in YYYY-MM-DD format"}), 400

    end_date = None
    if end_date_str:
        try:
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
            if end_date < start_date:
                return jsonify({"error": "end_date must be after start_date"}), 400
        except ValueError:
            return jsonify({"error": "end_date must be in YYYY-MM-DD format"}), 400

    next_payment_date = None
    if next_payment_date_str:
        try:
            next_payment_date = datetime.strptime(next_payment_date_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "next_payment_date must be in YYYY-MM-DD format"}), 400

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
                INSERT INTO recurring_expenses (user_id, category_id, name, amount, frequency, start_date, end_date, next_payment_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], name, amount_value, frequency, start_date, end_date, next_payment_date),
            )
            expense_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Recurring expense created successfully",
                "expense": {
                    "id": expense_id,
                    "name": name,
                    "category": category_name,
                    "amount": amount_value,
                    "frequency": frequency,
                    "start_date": start_date_str,
                    "end_date": end_date_str,
                    "next_payment_date": next_payment_date_str,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create recurring expense"}), 500


@app.route("/recurring-expenses/<int:expense_id>", methods=["PUT"])
@jwt_required()
def update_recurring_expense(expense_id):
    """
    Update an existing recurring expense.

    Expected JSON:
    {
        "name": "string",
        "category": "string",
        "amount": number,
        "frequency": "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD" (optional),
        "next_payment_date": "YYYY-MM-DD" (optional),
        "is_active": boolean
    }

    Returns:
        200: Expense updated
        400: Validation error
        403: Not owner of expense
        404: Expense or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    name = data.get("name", "").strip()
    category_name = data.get("category", "").strip()
    amount = data.get("amount")
    frequency = data.get("frequency")
    start_date_str = data.get("start_date")
    end_date_str = data.get("end_date")
    next_payment_date_str = data.get("next_payment_date")
    is_active = data.get("is_active", True)

    if not name or not category_name or not start_date_str:
        return jsonify(
            {"error": "name, category and start_date are required"}
        ), 400

    valid_frequencies = ("weekly", "biweekly", "monthly", "quarterly", "yearly")
    if frequency and frequency not in valid_frequencies:
        return jsonify({"error": f"Frequency must be one of: {', '.join(valid_frequencies)}"}), 400

    try:
        amount_value = float(amount) if amount is not None else None
        if amount_value is not None and amount_value < 0:
            return jsonify({"error": "Amount must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Amount must be a valid number"}), 400

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "start_date must be in YYYY-MM-DD format"}), 400

    end_date = None
    if end_date_str:
        try:
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
            if end_date < start_date:
                return jsonify({"error": "end_date must be after start_date"}), 400
        except ValueError:
            return jsonify({"error": "end_date must be in YYYY-MM-DD format"}), 400

    next_payment_date = None
    if next_payment_date_str:
        try:
            next_payment_date = datetime.strptime(next_payment_date_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "next_payment_date must be in YYYY-MM-DD format"}), 400

    try:
        with get_cursor() as cursor:
            # Verify expense belongs to this user
            cursor.execute(
                """
                SELECT re.id FROM recurring_expenses re
                JOIN users u ON re.user_id = u.id
                WHERE re.id = %s AND u.username = %s
                """,
                (expense_id, current_user),
            )
            expense = cursor.fetchone()

            if not expense:
                return jsonify({"error": "Expense not found or access denied"}), 404

            # Resolve category
            cursor.execute(
                "SELECT id FROM finance_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                UPDATE recurring_expenses
                SET category_id = %s, name = %s, amount = %s, frequency = %s, 
                    start_date = %s, end_date = %s, next_payment_date = %s, is_active = %s
                WHERE id = %s
                """,
                (category["id"], name, amount_value, frequency, start_date, end_date, next_payment_date, is_active, expense_id),
            )

        return jsonify({"message": "Recurring expense updated successfully", "id": expense_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update recurring expense"}), 500


@app.route("/recurring-expenses/delete", methods=["POST"])
@jwt_required()
def delete_recurring_expense():
    """
    Delete a recurring expense by expense_id.

    Expects JSON:
    {
        "expense_id": int
    }

    Returns:
        200: Expense deleted
        400: Validation error
        403: Not owner of expense
        404: Expense not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "expense_id" not in data:
        return jsonify({"error": "expense_id is required"}), 400

    expense_id = data["expense_id"]

    try:
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT re.id FROM recurring_expenses re
                JOIN users u ON re.user_id = u.id
                WHERE re.id = %s AND u.username = %s
                """,
                (expense_id, current_user),
            )
            expense = cursor.fetchone()

            if not expense:
                return jsonify({"error": "Expense not found or access denied"}), 404

            cursor.execute("DELETE FROM recurring_expenses WHERE id = %s", (expense_id,))

        return jsonify({"message": "Recurring expense deleted successfully", "id": expense_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete recurring expense"}), 500


@app.route("/recurring-expenses/batch-import", methods=["POST"])
@jwt_required()
def batch_import_recurring_expenses():
    """
    Batch import multiple recurring expenses from a single request.

    Expected JSON:
    {
        "expenses": [
            {
                "category": "string",
                "name": "string",
                "amount": number,
                "frequency": "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
                "start_date": "YYYY-MM-DD",
                "end_date": "YYYY-MM-DD" (optional),
                "next_payment_date": "YYYY-MM-DD" (optional),
                "is_active": boolean (optional, defaults to true)
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

    if not data or "expenses" not in data:
        return jsonify({"error": "expenses array is required"}), 400

    expenses = data["expenses"]
    if not isinstance(expenses, list):
        return jsonify({"error": "expenses must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}

    # First, get or create all finance categories
    category_cache = {}
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"]] = cat["id"]
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

    valid_frequencies = ("weekly", "biweekly", "monthly", "quarterly", "yearly")

    for i, expense in enumerate(expenses):
        try:
            category_name = expense.get("category", "").strip()
            name = expense.get("name", "").strip()
            amount = expense.get("amount")
            frequency = expense.get("frequency", "monthly")
            start_date_str = expense.get("start_date")
            end_date_str = expense.get("end_date")
            next_payment_date_str = expense.get("next_payment_date")
            is_active = expense.get("is_active", True)

            if not category_name or not name or not start_date_str:
                raise ValueError("category, name and start_date are required")

            # Validate amount
            amount_value = float(amount)
            if amount_value < 0:
                raise ValueError("Amount must be non-negative")

            # Validate frequency
            if frequency not in valid_frequencies:
                raise ValueError(f"Frequency must be one of: {', '.join(valid_frequencies)}")

            # Parse and validate dates
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()

            end_date = None
            if end_date_str:
                end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
                if end_date < start_date:
                    raise ValueError("end_date must be after start_date")

            next_payment_date = None
            if next_payment_date_str:
                next_payment_date = datetime.strptime(next_payment_date_str, "%Y-%m-%d").date()

            # Get or create category
            if category_name not in category_cache:
                with get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (category_name,)
                    )
                    category_cache[category_name] = cursor.lastrowid

            category_id = category_cache[category_name]

            # Insert recurring expense
            with get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO recurring_expenses (user_id, category_id, name, amount, frequency, start_date, end_date, next_payment_date, is_active)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, name, amount_value, frequency, start_date, end_date, next_payment_date, is_active)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to import recurring expense {i}: {e}")

    return jsonify(results), 200


# ─── TODO Routes ──────────────────────────────────────────────────────────────


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

            # Convert datetime objects to strings
            for item in items:
                for field in ["due_date", "completed_at", "created_at", "updated_at"]:
                    if item[field] is not None:
                        item[field] = item[field].isoformat()

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
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional)
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

    if not title or len(title) > 255:
        return jsonify(
            {"error": "Title must be between 1 and 255 characters"}
        ), 400

    valid_priorities = ("low", "medium", "high")
    if priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                )
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
                INSERT INTO todo_items (user_id, category_id, title, description, priority, due_date)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], title, description, priority, due_date),
            )
            item_id = cursor.lastrowid

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
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional)
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

    valid_priorities = ("low", "medium", "high")
    if priority and priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    valid_statuses = ("pending", "in_progress", "completed")
    if status and status not in valid_statuses:
        return jsonify({"error": f"Status must be one of: {', '.join(valid_statuses)}"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                )
            due_date = due_date.astimezone(timezone.utc)
        except ValueError:
            return jsonify({"error": "due_date must be ISO 8601 format with timezone"}), 400

    try:
        with get_cursor() as cursor:
            # Verify item belongs to this user
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

            if not updates:
                return jsonify({"error": "No fields to update"}), 400

            values.append(item_id)
            query = f"UPDATE todo_items SET {', '.join(updates)} WHERE id = %s"

            cursor.execute(query, values)

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
                    SELECT ti.id FROM todo_items ti
                    JOIN users u ON ti.user_id = u.id
                    WHERE ti.id = %s AND u.username = %s
                    """,
                    (item_id, current_user),
                )
                item = cursor.fetchone()

                if not item:
                    raise ValueError("TODO item not found or access denied")

                completed_at = datetime.now(timezone.utc) if status == "completed" else None

                cursor.execute(
                    """
                    UPDATE todo_items
                    SET status = %s, completed_at = %s
                    WHERE id = %s
                    """,
                    (status, completed_at, item_id),
                )

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
        "todo_id": int (optional)
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

            # Create session record
            cursor.execute(
                """
                INSERT INTO pomodoro_sessions (user_id, todo_id, duration_seconds, completed, session_date)
                VALUES (%s, %s, 0, FALSE, %s)
                """,
                (user["id"], todo_id, datetime.now(timezone.utc)),
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
            # Verify session belongs to this user
            cursor.execute(
                """
                SELECT ps.id FROM pomodoro_sessions ps
                JOIN users u ON ps.user_id = u.id
                WHERE ps.id = %s AND u.username = %s
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute(
                """
                UPDATE pomodoro_sessions
                SET duration_seconds = %s, completed = TRUE
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
    Cancel a Pomodoro session (delete incomplete session).

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
                WHERE ps.id = %s AND u.username = %s AND ps.completed = FALSE
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute("DELETE FROM pomodoro_sessions WHERE id = %s", (session_id,))

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
                    ps.duration_seconds,
                    ps.completed,
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

            # Total sessions
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND completed = TRUE
                """,
                (user_id,),
            )
            total_stats = cursor.fetchone()

            # Today's sessions
            today = datetime.now(timezone.utc).date()
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND completed = TRUE
                AND DATE(session_date) = %s
                """,
                (user_id, today),
            )
            today_stats = cursor.fetchone()

            # This week's sessions (last 7 days)
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND completed = TRUE
                AND session_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                """,
                (user_id,),
            )
            week_stats = cursor.fetchone()

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
            },
        }), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch Pomodoro stats"}), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 3000)),
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true",
    )
