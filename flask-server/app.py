from flask import Flask, request, jsonify
import mysql.connector
from mysql.connector import Error
import bcrypt
import os
from datetime import datetime

app = Flask(__name__)

# Database configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'mysql-db'),
    # 'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'user': os.getenv('DB_USER', 'username'),
    'password': os.getenv('DB_PASSWORD', '1234'),
    'database': os.getenv('DB_NAME', 'time_tracker')
}


def get_db_connection():
    """Create and return a database connection."""
    try:
        connection = mysql.connector.connect(**DB_CONFIG)
        return connection
    except Error as e:
        print(f"Error connecting to MySQL: {e}")
        return None


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'healthy'}), 200


@app.route('/entries/<string:username>', methods=['GET'])
def get_entries_by_user(username):
    """
    Retrieve all time entries for a given username.

    Returns:
        200: List of entries
        404: User not found
        500: Server error
    """
    username = username.strip()

    if not username:
        return jsonify({'error': 'Username is required'}), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor(dictionary=True)

        # Check if user exists
        cursor.execute(
            "SELECT id FROM users WHERE username = %s",
            (username,)
        )
        user = cursor.fetchone()

        if not user:
            return jsonify({'error': 'User not found'}), 404

        # Retrieve entries with JOIN
        query = """
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
        """

        cursor.execute(query, (user['id'],))
        entries = cursor.fetchall()

        return jsonify({
            'username': username,
            'entries': entries
        }), 200

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Failed to fetch entries'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


@app.route('/register', methods=['POST'])
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

    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Username and password are required'}), 400

    username = data['username'].strip()
    password = data['password']

    # Validate input
    if not username or len(username) > 100:
        return jsonify({'error': 'Username must be between 1 and 100 characters'}), 400

    if not password or len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    # Generate salt and hash password
    salt = bcrypt.gensalt()
    pwd_hash = bcrypt.hashpw(password.encode('utf-8'), salt)

    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor()

        # Insert user into database
        query = """
            INSERT INTO users (username, pwd_hash, salt)
            VALUES (%s, %s, %s)
        """
        cursor.execute(query, (username, pwd_hash, salt))
        connection.commit()

        user_id = cursor.lastrowid

        return jsonify({
            'message': 'User registered successfully',
            'user_id': user_id,
            'username': username
        }), 201

    except mysql.connector.IntegrityError as e:
        # Username already exists (unique constraint violation)
        return jsonify({'error': 'Username already exists'}), 409

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Failed to register user'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


@app.route('/login', methods=['POST'])
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

    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Username and password are required'}), 400

    username = data['username'].strip()
    password = data['password']

    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor(dictionary=True)

        # Retrieve user from database
        query = """
            SELECT id, username, pwd_hash, salt
            FROM users
            WHERE username = %s
        """
        cursor.execute(query, (username,))
        user = cursor.fetchone()

        if not user:
            return jsonify({'error': 'Invalid username or password'}), 401

        # Verify password
        # Convert bytearray to bytes for bcrypt compatibility
        stored_hash = bytes(user['pwd_hash'])
        salt = bytes(user['salt'])
        provided_hash = bcrypt.hashpw(password.encode('utf-8'), salt)

        if stored_hash == provided_hash:
            return jsonify({
                'message': 'Login successful',
                'authenticated': True,
                'user_id': user['id'],
                'username': user['username']
            }), 200
        else:
            return jsonify({'error': 'Invalid username or password'}), 401

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Login failed'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


@app.route('/users', methods=['GET'])
def list_users():
    """
    List all users (without sensitive data).

    Returns:
        200: List of users
        500: Server error
    """
    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor(dictionary=True)

        query = "SELECT id, username FROM users ORDER BY id"
        cursor.execute(query)
        users = cursor.fetchall()

        return jsonify({'users': users}), 200

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Failed to fetch users'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


@app.route('/category', methods=['POST'])
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

    if not data or 'name' not in data:
        return jsonify({'error': 'Category name is required'}), 400

    name = data['name'].strip()

    if not name or len(name) > 100:
        return jsonify({'error': 'Category name must be between 1 and 100 characters'}), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor(dictionary=True)

        # Check if category exists
        cursor.execute("SELECT id, name FROM category WHERE name = %s", (name,))
        existing = cursor.fetchone()

        if existing:
            return jsonify({
                'message': 'Category already exists',
                'category': existing
            }), 200

        # Insert new category
        cursor.execute(
            "INSERT INTO category (name) VALUES (%s)",
            (name,)
        )
        connection.commit()

        category_id = cursor.lastrowid

        return jsonify({
            'message': 'Category created successfully',
            'category': {
                'id': category_id,
                'name': name
            }
        }), 201

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Failed to create category'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()



@app.route('/entry', methods=['POST'])
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

    required_fields = ['username', 'category', 'start_time', 'end_time']
    if not data or not all(field in data for field in required_fields):
        return jsonify({'error': 'username, category, start_time and end_time are required'}), 400

    username = data['username'].strip()
    category_name = data['category'].strip()
    start_time_str = data['start_time']
    end_time_str = data['end_time']

    # Validate datetime format
    try:
        start_time = datetime.strptime(start_time_str, "%Y-%m-%d %H:%M:%S")
        end_time = datetime.strptime(end_time_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return jsonify({
            'error': 'Datetime format must be YYYY-MM-DD HH:MM:SS'
        }), 400

    if end_time <= start_time:
        return jsonify({
            'error': 'end_time must be after start_time'
        }), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({'error': 'Database connection failed'}), 500

    try:
        cursor = connection.cursor(dictionary=True)

        # Get user ID
        cursor.execute(
            "SELECT id FROM users WHERE username = %s",
            (username,)
        )
        user = cursor.fetchone()

        if not user:
            return jsonify({'error': 'User not found'}), 404

        # Get category ID
        cursor.execute(
            "SELECT id FROM category WHERE name = %s",
            (category_name,)
        )
        category = cursor.fetchone()

        if not category:
            return jsonify({'error': 'Category not found'}), 404

        # Insert time entry
        insert_query = """
            INSERT INTO time_entries (user_id, category_id, start_time, end_time)
            VALUES (%s, %s, %s, %s)
        """

        cursor.execute(
            insert_query,
            (user['id'], category['id'], start_time, end_time)
        )
        connection.commit()

        entry_id = cursor.lastrowid

        return jsonify({
            'message': 'Time entry created successfully',
            'entry': {
                'id': entry_id,
                'username': username,
                'category': category_name,
                'start_time': start_time_str,
                'end_time': end_time_str
            }
        }), 201

    except Error as e:
        print(f"Database error: {e}")
        return jsonify({'error': 'Failed to create time entry'}), 500

    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()


if __name__ == '__main__':
    # Run the Flask app
    app.run(
        host='0.0.0.0',
        port=int(os.getenv('PORT', 5000)),
        debug=os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    )
