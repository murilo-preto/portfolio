# Time Tracker API

A RESTful API built with **Flask** and **MySQL** for tracking user time
entries by category.\
It supports user registration, authentication, category management, and
time entry creation.

---

## 🧱 Tech Stack

- Python 3.10+
- Flask
- MySQL 8
- mysql-connector-python
- bcrypt (password hashing)
- Docker-compatible configuration

---

## 📦 Features

- User registration with salted + hashed passwords (bcrypt)
- User login with credential verification
- Create and list categories
- Create time entries
- Retrieve all time entries for a given user
- Health check endpoint
- MySQL connection pooling (5 connections)

---

## 🗄 Database Schema

### users

Column Type Notes

---

id INT (PK, AI) Primary key
username VARCHAR(100) Unique
pwd_hash BLOB bcrypt hash
salt BLOB bcrypt salt

### category

Column Type Notes

---

id INT (PK, AI) Primary key
name VARCHAR(100) Unique

### time_entries

Column Type Notes

---

id INT (PK, AI) Primary key
user_id INT (FK) References users.id
category_id INT (FK) References category.id
start_time DATETIME  
 end_time DATETIME

---

## ⚙️ Environment Variables

Variable Default Description

---

DB_HOST mysql-db MySQL host
DB_PORT 3306 MySQL port
DB_USER username Database user
DB_PASSWORD 1234 Database password
DB_NAME time_tracker Database name
PORT 3000 Flask app port
FLASK_DEBUG False Enable debug mode

---

## 🚀 Running the Application

### Install Dependencies

pip install flask mysql-connector-python bcrypt

### Run MySQL (Docker Example)

docker run -d\
--name mysql-db\
-p 3306:3306\
-e MYSQL_ROOT_PASSWORD=admin\
-e MYSQL_DATABASE=time_tracker\
-e MYSQL_USER=username\
-e MYSQL_PASSWORD=1234\
mysql:8.0

### Run the API

python app.py

Server runs at:

<http://localhost:3000>

---

## 📡 API Endpoints

### GET /health

Returns service status.

---

### POST /register

Request:

{ "username": "john", "password": "securepassword" }

---

### POST /login

Request:

{ "username": "john", "password": "securepassword" }

---

### GET /users

Returns all users (without sensitive data).

---

### POST /category

Request:

{ "name": "Work" }

---

### POST /entry

Request:

{ "username": "john", "category": "Work", "start_time": "2026-02-10
09:00:00", "end_time": "2026-02-10 11:30:00" }

---

### GET /entries/`<username>`{=html}

Returns all time entries for the specified user.
