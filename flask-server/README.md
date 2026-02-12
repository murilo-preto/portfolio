# Flask Time Tracker API

A Flask REST API for:

- User registration and authentication (bcrypt)
- Category management
- Time entry tracking with foreign key resolution

Backed by MySQL.

---

# Setup

## 1. Install dependencies

```bash
pip install -r requirements.txt
```

## 2. Ensure MySQL is running

```bash
./deploy_mysql.sh
```

Make sure the database `time_tracker` exists and contains:

- `users`
- `category`
- `time_entries`

## 3. Run the Flask server

```bash
python app.py
```

Server starts at:

    http://localhost:5000

---

# Database Schema Overview

## users

Field Type

---

id int unsigned (PK)
username varchar(100) (UNIQUE)
pwd_hash varbinary(255)
salt varbinary(255)

## category

Field Type

---

id int unsigned (PK)
name varchar(100) (UNIQUE)

## time_entries

Field Type

---

id int unsigned (PK)
user_id int unsigned (FK → users.id)
category_id int unsigned (FK → category.id)
start_time datetime
end_time datetime

---

# API Endpoints

## Health Check

GET /health

Response:

{ "status": "healthy" }

---

## Register User

POST /register

{ "username": "john_doe", "password": "mypassword123" }

Success (201):

{ "message": "User registered successfully", "user_id": 1, "username":
"john_doe" }

---

## Login

POST /login

{ "username": "john_doe", "password": "mypassword123" }

Success (200):

{ "message": "Login successful", "authenticated": true, "user_id": 1,
"username": "john_doe" }

---

## Create Category

POST /category

{ "name": "Work" }

---

## Create Time Entry

POST /entry

{ "username": "john_doe", "category": "Work", "start_time": "2026-02-11
09:00:00", "end_time": "2026-02-11 10:30:00" }

Datetime format must be:

YYYY-MM-DD HH:MM:SS

---

# Environment Variables

- DB_HOST (default: mysql-db)
- DB_PORT (default: 3306)
- DB_USER
- DB_PASSWORD
- DB_NAME (default: time_tracker)
- PORT (default: 5000)
- FLASK_DEBUG (default: False)

---

# Security Features

- bcrypt hashing
- Unique salt per password
- No plaintext password storage
- Unique username constraint
- Input validation
- Foreign key integrity enforcement
