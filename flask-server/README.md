# Flask API — Endpoints

---

GET /health
→ 200 OK
{
"status": "healthy"
}

---

POST /register
Body:
{
"username": "string",
"password": "string"
}

→ 201 Created
→ 400 Validation error
→ 409 Username exists

---

POST /login
Body:
{
"username": "string",
"password": "string"
}

→ 200 OK
{
"access_token": "JWT_TOKEN",
"user_id": 1,
"username": "string"
}

→ 401 Invalid credentials

---

Authorization Header (protected routes):
Authorization: Bearer <JWT_TOKEN>

---

GET /protected
→ 200 OK
{
"message": "Access granted"
}

→ 401 Invalid or missing token

---

GET /users
→ 200 OK
{
"users": [
{ "id": 1, "username": "string" }
]
}

---

GET /entries/<username>
→ 200 OK
{
"entries": [
{
"id": 1,
"category": "string",
"start_time": "YYYY-MM-DD HH:MM:SS",
"end_time": "YYYY-MM-DD HH:MM:SS",
"duration_seconds": 3600
}
]
}

→ 404 User not found

---

GET /myentries
(Requires JWT)

→ 200 OK
{
"entries": [ ... ]
}

---

POST /entry
Body:
{
"username": "string",
"category": "string",
"start_time": "YYYY-MM-DD HH:MM:SS",
"end_time": "YYYY-MM-DD HH:MM:SS"
}

→ 201 Created
{
"id": 1
}

---

POST /category
Body:
{
"name": "string"
}

→ 201 Created
→ 200 Already exists
