# Flask User Authentication API

A Flask REST API with user registration and login using bcrypt for password hashing.

## Setup

1. **Install dependencies:**
```bash
pip install -r requirements.txt
```

2. **Ensure MySQL is running:**
```bash
./deploy_mysql.sh
```

3. **Run the Flask server:**
```bash
python app.py
```

The server will start on `http://localhost:5000`

## API Endpoints

### 1. Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy"
}
```

---

### 2. Register User
```bash
POST /register
Content-Type: application/json

{
  "username": "john_doe",
  "password": "mypassword123"
}
```

**Success Response (201):**
```json
{
  "message": "User registered successfully",
  "user_id": 1,
  "username": "john_doe"
}
```

**Error Responses:**
- `400`: Missing fields or validation error
- `409`: Username already exists
- `500`: Server error

---

### 3. Login
```bash
POST /login
Content-Type: application/json

{
  "username": "john_doe",
  "password": "mypassword123"
}
```

**Success Response (200):**
```json
{
  "message": "Login successful",
  "authenticated": true,
  "user_id": 1,
  "username": "john_doe"
}
```

**Error Responses:**
- `400`: Missing fields
- `401`: Invalid credentials
- `500`: Server error

---

### 4. List Users
```bash
GET /users
```

**Response (200):**
```json
{
  "users": [
    {
      "id": 1,
      "username": "john_doe"
    },
    {
      "id": 2,
      "username": "jane_smith"
    }
  ]
}
```

## Testing with cURL

### Register a new user:
```bash
curl -X POST http://localhost:5000/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'
```

### Login:
```bash
curl -X POST http://localhost:5000/login \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'
```

### List all users:
```bash
curl http://localhost:5000/users
```

## Environment Variables

You can configure the database connection using environment variables:

- `DB_HOST` (default: localhost)
- `DB_PORT` (default: 3306)
- `DB_USER` (default: mpreto)
- `DB_PASSWORD` (default: 1234)
- `DB_NAME` (default: time_tracker)
- `PORT` (default: 5000)
- `FLASK_DEBUG` (default: False)

Example:
```bash
DB_HOST=192.168.1.100 DB_PORT=3307 python app.py
```

## Security Features

- **bcrypt hashing**: Industry-standard password hashing algorithm
- **Salt generation**: Each password gets a unique salt
- **No plaintext passwords**: Passwords are never stored in plaintext
- **Input validation**: Username and password requirements enforced
- **Unique usernames**: Database constraint prevents duplicate usernames

## Password Storage

The application uses bcrypt with automatic salt generation:
1. When registering, `bcrypt.gensalt()` generates a unique salt
2. The password is hashed with the salt using `bcrypt.hashpw()`
3. Both the hash and salt are stored in the database
4. During login, the provided password is hashed with the stored salt and compared
