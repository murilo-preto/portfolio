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


@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify(error="Missing or invalid token"), 401


@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify(error="Invalid token"), 401


@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify(error="Token expired"), 401


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 3000)),
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true",
    )
