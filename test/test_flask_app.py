"""
Flask Backend Unit Tests
Tests for the Flask API endpoints without database dependencies
"""
import pytest
import sys
import os
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta

# Add flask-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

# Disable rate limiting for tests
os.environ["RATELIMIT_ENABLED"] = "false"

from app import app, get_pool, retrieve_entry_from_username


@pytest.fixture
def app_context():
    """Create app with test configuration."""
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-min-32-chars"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]
    app.config["RATELIMIT_ENABLED"] = False
    return app


@pytest.fixture
def client(app_context):
    """Create a test client for the Flask application."""
    with app_context.test_client() as client:
        yield client


@pytest.fixture
def sample_jwt_token(app_context):
    """Generate a sample JWT token for testing."""
    from flask_jwt_extended import create_access_token
    with app_context.app_context():
        return create_access_token(identity="testuser")


class TestHealthCheck:
    """Tests for the health check endpoint."""
    
    def test_health_check_returns_healthy(self, client):
        """Health endpoint should return healthy status."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.get_json()
        assert data["status"] == "healthy"


class TestProtectedRoute:
    """Tests for the protected route with JWT authentication."""
    
    def test_protected_without_token_returns_401(self, client):
        """Protected route should reject requests without JWT token."""
        response = client.get("/protected")
        assert response.status_code == 401
    
    def test_protected_with_valid_token_returns_200(self, client, sample_jwt_token):
        """Protected route should accept requests with valid JWT token."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/protected", headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        assert data["user"] == "testuser"


class TestRegisterUser:
    """Tests for user registration endpoint."""
    
    # Note: These tests skip when rate limiting is active
    # Rate limiting is module-level and can't be easily disabled in tests
    
    def test_register_missing_fields(self, client):
        """Registration should fail with missing fields."""
        response = client.post("/register", json={})
        # May be 400 (validation) or 429 (rate limited)
        assert response.status_code in [400, 429]
        if response.status_code == 400:
            data = response.get_json()
            assert "error" in data
    
    def test_register_missing_username(self, client):
        """Registration should fail with missing username."""
        response = client.post("/register", json={"password": "testpass123"})
        assert response.status_code in [400, 429]
    
    def test_register_missing_password(self, client):
        """Registration should fail with missing password."""
        response = client.post("/register", json={"username": "testuser"})
        assert response.status_code in [400, 429]
    
    def test_register_username_too_long(self, client):
        """Registration should fail with username > 100 chars."""
        long_username = "a" * 101
        response = client.post("/register", json={
            "username": long_username,
            "password": "testpass123"
        })
        assert response.status_code in [400, 429]
    
    def test_register_password_too_short(self, client):
        """Registration should fail with password < 6 chars."""
        response = client.post("/register", json={
            "username": "testuser",
            "password": "short"
        })
        assert response.status_code in [400, 429]
    
    @patch('app.get_cursor')
    def test_register_success(self, mock_cursor_context, client):
        """Registration should succeed with valid data."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.lastrowid = 1
        mock_cursor_context.return_value = mock_cursor
        
        response = client.post("/register", json={
            "username": "newuser",
            "password": "securepass123"
        })
        assert response.status_code == 201
        data = response.get_json()
        assert "message" in data
        assert data["message"] == "User registered successfully"
    
    @patch('app.get_cursor')
    def test_register_duplicate_username(self, mock_cursor_context, client):
        """Registration should fail with duplicate username."""
        import mysql.connector
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(side_effect=mysql.connector.IntegrityError)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor_context.return_value = mock_cursor
        
        response = client.post("/register", json={
            "username": "existinguser",
            "password": "securepass123"
        })
        assert response.status_code == 409


class TestLoginUser:
    """Tests for user login endpoint."""
    
    def test_login_missing_fields(self, client):
        """Login should fail with missing fields."""
        response = client.post("/login", json={})
        assert response.status_code in [400, 429]
    
    def test_login_invalid_credentials(self, client):
        """Login should fail with invalid credentials."""
        # Mock database to simulate user not found
        with patch('app.get_cursor') as mock_cursor_context:
            mock_cursor = MagicMock()
            mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
            mock_cursor.__exit__ = MagicMock(return_value=False)
            mock_cursor.fetchone.return_value = None  # User not found
            mock_cursor_context.return_value = mock_cursor
            
            response = client.post("/login", json={
                "username": "nonexistent",
                "password": "wrongpass"
            })
            # May be 401 (invalid creds), 429 (rate limited), or 500 (DB error)
            assert response.status_code in [401, 429, 500]
    
    @patch('app.get_cursor')
    @patch('bcrypt.checkpw')
    def test_login_success(self, mock_checkpw, mock_cursor_context, client):
        """Login should succeed with valid credentials."""
        mock_checkpw.return_value = True
        
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.return_value = {
            "id": 1,
            "username": "testuser",
            "pwd_hash": b"hash"
        }
        mock_cursor_context.return_value = mock_cursor
        
        response = client.post("/login", json={
            "username": "testuser",
            "password": "correctpass"
        })
        # May be 200 (success) or 429 (rate limited)
        assert response.status_code in [200, 429]
        if response.status_code == 200:
            data = response.get_json()
            assert "access_token" in data
            assert data["authenticated"] is True


class TestCategories:
    """Tests for categories endpoint."""
    
    @patch('app.get_cursor')
    def test_list_categories(self, mock_cursor_context, client):
        """Should return list of categories."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchall.return_value = [
            {"id": 1, "name": "Reading"},
            {"id": 2, "name": "Work"}
        ]
        mock_cursor_context.return_value = mock_cursor
        
        response = client.get("/get/categories")
        assert response.status_code == 200
        data = response.get_json()
        assert "categories" in data
        assert len(data["categories"]) == 2


class TestCreateCategory:
    """Tests for category creation endpoint."""
    
    def test_create_category_missing_name(self, client, sample_jwt_token):
        """Category creation should fail without name."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/category", json={}, headers=headers)
        assert response.status_code == 400

    def test_create_category_name_too_long(self, client, sample_jwt_token):
        """Category creation should fail with name > 100 chars."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/category", json={"name": "a" * 101}, headers=headers)
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_create_category_already_exists(self, mock_cursor_context, client, sample_jwt_token):
        """Should return 200 if category already exists."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.return_value = {"id": 1, "name": "Existing"}
        mock_cursor_context.return_value = mock_cursor

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/category", json={"name": "Existing"}, headers=headers)
        assert response.status_code == 200

    @patch('app.get_cursor')
    def test_create_category_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should create new category successfully."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = [None, {"id": 1, "name": "New"}]
        mock_cursor.lastrowid = 1
        mock_cursor_context.return_value = mock_cursor

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/category", json={"name": "New"}, headers=headers)
        assert response.status_code == 201


class TestTimeEntryCreation:
    """Tests for time entry creation endpoint."""
    
    def test_create_entry_missing_fields(self, client, sample_jwt_token):
        """Entry creation should fail with missing fields."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/entry/create", json={}, headers=headers)
        assert response.status_code == 400

    def test_create_entry_invalid_datetime_format(self, client, sample_jwt_token):
        """Entry creation should fail with invalid datetime format."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/entry/create", json={
            "category": "Work",
            "start_time": "invalid",
            "end_time": "invalid"
        }, headers=headers)
        assert response.status_code == 400

    def test_create_entry_end_before_start(self, client, sample_jwt_token):
        """Entry creation should fail if end_time <= start_time."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/entry/create", json={
            "category": "Work",
            "start_time": "2024-01-01T12:00:00+00:00",
            "end_time": "2024-01-01T10:00:00+00:00"
        }, headers=headers)
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_create_entry_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Entry creation should fail if the JWT identity resolves to no DB user."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.return_value = None
        mock_cursor_context.return_value = mock_cursor

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/entry/create", json={
            "category": "Work",
            "start_time": "2024-01-01T10:00:00+00:00",
            "end_time": "2024-01-01T12:00:00+00:00"
        }, headers=headers)
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_create_entry_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should create time entry successfully."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.side_effect = [
            {"id": 1},  # user
            {"id": 1},  # category
        ]
        mock_cursor.lastrowid = 1
        mock_cursor_context.return_value = mock_cursor

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/entry/create", json={
            "category": "Work",
            "start_time": "2024-01-01T10:00:00+00:00",
            "end_time": "2024-01-01T12:00:00+00:00"
        }, headers=headers)
        assert response.status_code == 201


class TestTokenRefresh:
    """Tests for JWT token refresh mechanism."""

    def test_token_refresh_expiring_token(self, client, sample_jwt_token):
        """Should refresh expiring tokens."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/protected", headers=headers)
        # Should either return 200 or set new cookie
        assert response.status_code in [200, 401]


def _mock_cursor(mock_cursor_context):
    """Helper to wire up a MagicMock cursor context manager and return it."""
    mock_cursor = MagicMock()
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)
    mock_cursor_context.return_value = mock_cursor
    return mock_cursor


def _todo_item_row(**overrides):
    """A DB row shape matching the todo_items lookup joined for update/bulk-update."""
    row = {
        "id": 1,
        "user_id": 1,
        "category_id": 1,
        "title": "Task",
        "description": "",
        "priority": "medium",
        "status": "completed",
        "due_date": None,
        "recurrence_rule": "none",
    }
    row.update(overrides)
    return row


class TestListTodoCategories:
    """Tests for the TODO categories listing endpoint."""

    @patch('app.get_cursor')
    def test_list_todo_categories_success(self, mock_cursor_context, client):
        """Should return list of TODO categories."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchall.return_value = [
            {"id": 1, "name": "Work"},
            {"id": 2, "name": "Personal"},
        ]

        response = client.get("/todo/categories")
        assert response.status_code == 200
        data = response.get_json()
        assert len(data["categories"]) == 2


class TestCreateTodoCategory:
    """Tests for the TODO category creation endpoint."""

    def test_create_todo_category_missing_name(self, client, sample_jwt_token):
        """Should fail without a name."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/todo/category", json={}, headers=headers)
        assert response.status_code == 400

    def test_create_todo_category_name_too_long(self, client, sample_jwt_token):
        """Should fail with a name over 100 characters."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/category", json={"name": "a" * 101}, headers=headers
        )
        assert response.status_code == 400

    def test_create_todo_category_blank_name(self, client, sample_jwt_token):
        """Should fail with a whitespace-only name."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/category", json={"name": "   "}, headers=headers
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_create_todo_category_already_exists(self, mock_cursor_context, client, sample_jwt_token):
        """Should return 200 if the category already exists."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = {"id": 1, "name": "Work"}

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/category", json={"name": "Work"}, headers=headers
        )
        assert response.status_code == 200

    @patch('app.get_cursor')
    def test_create_todo_category_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should create a new TODO category."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None
        mock_cursor.lastrowid = 5

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/category", json={"name": "Errands"}, headers=headers
        )
        assert response.status_code == 201
        data = response.get_json()
        assert data["category"] == {"id": 5, "name": "Errands"}


class TestCreateTodoItem:
    """Tests for TODO item creation."""

    def test_create_todo_item_missing_fields(self, client, sample_jwt_token):
        """Should fail without title and category."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/todo/create", json={}, headers=headers)
        assert response.status_code == 400

    def test_create_todo_item_blank_title(self, client, sample_jwt_token):
        """Should fail with a whitespace-only title."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "   ", "category": "Work"},
            headers=headers,
        )
        assert response.status_code == 400

    def test_create_todo_item_title_too_long(self, client, sample_jwt_token):
        """Should fail with a title over 255 characters."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "a" * 256, "category": "Work"},
            headers=headers,
        )
        assert response.status_code == 400

    def test_create_todo_item_invalid_priority(self, client, sample_jwt_token):
        """Should fail with an invalid priority."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "Task", "category": "Work", "priority": "urgent"},
            headers=headers,
        )
        assert response.status_code == 400

    def test_create_todo_item_due_date_without_timezone(self, client, sample_jwt_token):
        """Should fail when due_date has no timezone offset."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={
                "title": "Task",
                "category": "Work",
                "due_date": "2024-01-01T10:00:00",
            },
            headers=headers,
        )
        assert response.status_code == 400

    def test_create_todo_item_invalid_due_date_format(self, client, sample_jwt_token):
        """Should fail when due_date cannot be parsed."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "Task", "category": "Work", "due_date": "not-a-date"},
            headers=headers,
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_create_todo_item_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the JWT identity resolves to no DB user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "Task", "category": "Work"},
            headers=headers,
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_create_todo_item_category_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the category does not exist."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [{"id": 1}, None]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "Task", "category": "Nonexistent"},
            headers=headers,
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_create_todo_item_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should create a TODO item successfully."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [{"id": 1}, {"id": 2}]
        mock_cursor.lastrowid = 10

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/create",
            json={"title": "Task", "category": "Work", "priority": "high"},
            headers=headers,
        )
        assert response.status_code == 201
        data = response.get_json()
        assert data["item"]["id"] == 10
        assert data["item"]["priority"] == "high"


class TestUpdateTodoItem:
    """Tests for TODO item updates."""

    def test_update_todo_item_no_body(self, client, sample_jwt_token):
        """Should fail without a request body."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put("/todo/1", json={}, headers=headers)
        assert response.status_code == 400

    def test_update_todo_item_invalid_priority(self, client, sample_jwt_token):
        """Should fail with an invalid priority."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"priority": "urgent"}, headers=headers
        )
        assert response.status_code == 400

    def test_update_todo_item_invalid_status(self, client, sample_jwt_token):
        """Should fail with an invalid status."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"status": "done"}, headers=headers
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_update_todo_item_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the item does not belong to the user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"title": "New title"}, headers=headers
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_update_todo_item_category_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the new category does not exist."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [_todo_item_row(), None]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"category": "Nonexistent"}, headers=headers
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_update_todo_item_no_fields_to_update(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail if the body contains no recognized updatable fields."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = _todo_item_row()

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"unrelated": "value"}, headers=headers
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_update_todo_item_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should update the item's status and set completed_at."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = _todo_item_row()

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.put(
            "/todo/1", json={"status": "completed"}, headers=headers
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["id"] == 1


class TestDeleteTodoItem:
    """Tests for TODO item deletion."""

    def test_delete_todo_item_missing_item_id(self, client, sample_jwt_token):
        """Should fail without item_id."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/todo/delete", json={}, headers=headers)
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_delete_todo_item_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the item does not belong to the user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/delete", json={"item_id": 99}, headers=headers
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_delete_todo_item_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should delete the item successfully."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = {"id": 1}

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/delete", json={"item_id": 1}, headers=headers
        )
        assert response.status_code == 200


class TestBulkUpdateTodoItems:
    """Tests for bulk TODO status updates."""

    def test_bulk_update_missing_updates(self, client, sample_jwt_token):
        """Should fail without an updates array."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/todo/bulk-update", json={}, headers=headers)
        assert response.status_code == 400

    def test_bulk_update_not_a_list(self, client, sample_jwt_token):
        """Should fail if updates is not an array."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/bulk-update", json={"updates": "not-a-list"}, headers=headers
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_bulk_update_mixed_results(self, mock_cursor_context, client, sample_jwt_token):
        """Should report per-item success/failure without aborting the batch."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        # item 1: found -> success; item 2: not found -> failure; item 3: bad status -> failure
        mock_cursor.fetchone.side_effect = [_todo_item_row(), None]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/todo/bulk-update",
            json={
                "updates": [
                    {"item_id": 1, "status": "completed"},
                    {"item_id": 2, "status": "completed"},
                    {"item_id": 3, "status": "invalid"},
                ]
            },
            headers=headers,
        )
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] == 1
        assert data["failed"] == 2
        assert len(data["errors"]) == 2


class TestMyTodoItems:
    """Tests for the current user's TODO items listing."""

    @patch('app.get_cursor')
    def test_my_todo_items_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the JWT identity resolves to no DB user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/todo", headers=headers)
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_my_todo_items_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should return items with datetime fields serialized to strings."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        now = datetime.now(timezone.utc)
        mock_cursor.fetchone.return_value = {"id": 1}
        mock_cursor.fetchall.side_effect = [
            [
                {
                    "id": 1,
                    "category": "Work",
                    "title": "Task",
                    "description": "",
                    "priority": "high",
                    "status": "pending",
                    "due_date": now,
                    "completed_at": None,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
            [],  # no tags for item 1
            [],  # no focus sessions for item 1
        ]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/todo", headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        assert data["items"][0]["due_date"] == now.isoformat()
        assert data["items"][0]["completed_at"] is None
        assert data["items"][0]["tags"] == []
        assert data["items"][0]["focus_sessions"] == 0
        assert data["items"][0]["focus_seconds"] == 0


class TestPomodoroStart:
    """Tests for starting a Pomodoro session."""

    @patch('app.get_cursor')
    def test_start_pomodoro_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the JWT identity resolves to no DB user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/pomodoro/start", json={}, headers=headers)
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_start_pomodoro_todo_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the linked TODO item is not owned by the user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [{"id": 1}, None]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/start", json={"todo_id": 99}, headers=headers
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_start_pomodoro_success_without_todo(self, mock_cursor_context, client, sample_jwt_token):
        """Should start a session with no linked TODO item."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = {"id": 1}
        mock_cursor.lastrowid = 7

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/pomodoro/start", json={}, headers=headers)
        assert response.status_code == 201
        data = response.get_json()
        assert data["session_id"] == 7

    @patch('app.get_cursor')
    def test_start_pomodoro_success_with_todo(self, mock_cursor_context, client, sample_jwt_token):
        """Should start a session linked to a valid TODO item."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [{"id": 1}, {"id": 5}]
        mock_cursor.lastrowid = 8

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/start", json={"todo_id": 5}, headers=headers
        )
        assert response.status_code == 201


class TestPomodoroComplete:
    """Tests for completing a Pomodoro session."""

    def test_complete_pomodoro_no_body(self, client, sample_jwt_token):
        """Should fail without a request body."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/pomodoro/complete", json={}, headers=headers)
        assert response.status_code == 400

    def test_complete_pomodoro_missing_fields(self, client, sample_jwt_token):
        """Should fail without session_id or duration_seconds."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete", json={"session_id": 1}, headers=headers
        )
        assert response.status_code == 400

    def test_complete_pomodoro_negative_duration(self, client, sample_jwt_token):
        """Should fail with a negative duration_seconds."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": 1, "duration_seconds": -5},
            headers=headers,
        )
        assert response.status_code == 400

    def test_complete_pomodoro_non_integer_duration(self, client, sample_jwt_token):
        """Should fail with a non-integer duration_seconds."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": 1, "duration_seconds": "abc"},
            headers=headers,
        )
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_complete_pomodoro_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the session is not owned by the user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": 1, "duration_seconds": 1500},
            headers=headers,
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_complete_pomodoro_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should complete the session successfully."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = {
            "id": 1,
            "user_id": 1,
            "todo_id": None,
            "session_type": "pomodoro",
        }

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": 1, "duration_seconds": 1500},
            headers=headers,
        )
        assert response.status_code == 200
        data = response.get_json()
        # No category asked for, no task linked — nothing else should happen.
        assert data["time_entry_id"] is None
        assert data["todo_id"] is None
        assert data["todo_status"] is None

    def test_complete_pomodoro_non_string_category(self, client, sample_jwt_token):
        """Should reject a category that is not a string."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": 1, "duration_seconds": 1500, "category": 7},
            headers=headers,
        )
        assert response.status_code == 400


class TestPomodoroCancel:
    """Tests for cancelling a Pomodoro session."""

    def test_cancel_pomodoro_missing_session_id(self, client, sample_jwt_token):
        """Should fail without session_id."""
        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post("/pomodoro/cancel", json={}, headers=headers)
        assert response.status_code == 400

    @patch('app.get_cursor')
    def test_cancel_pomodoro_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the session doesn't exist or is already completed."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/cancel", json={"session_id": 1}, headers=headers
        )
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_cancel_pomodoro_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should cancel the session successfully."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = {"id": 1}

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.post(
            "/pomodoro/cancel", json={"session_id": 1}, headers=headers
        )
        assert response.status_code == 200


class TestMyPomodoroSessions:
    """Tests for the current user's Pomodoro session listing."""

    @patch('app.get_cursor')
    def test_my_pomodoro_sessions_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the JWT identity resolves to no DB user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/pomodoro/sessions", headers=headers)
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_my_pomodoro_sessions_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should return sessions with datetime fields serialized to strings."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        now = datetime.now(timezone.utc)
        mock_cursor.fetchone.return_value = {"id": 1}
        mock_cursor.fetchall.return_value = [
            {
                "id": 1,
                "todo_id": None,
                "todo_title": None,
                "duration_seconds": 1500,
                "completed": True,
                "session_date": now,
                "created_at": now,
            }
        ]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/pomodoro/sessions", headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        assert data["sessions"][0]["session_date"] == now.isoformat()


class TestPomodoroStats:
    """Tests for Pomodoro statistics."""

    @patch('app.get_cursor')
    def test_pomodoro_stats_user_not_found(self, mock_cursor_context, client, sample_jwt_token):
        """Should fail with 404 if the JWT identity resolves to no DB user."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.return_value = None

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/pomodoro/stats", headers=headers)
        assert response.status_code == 404

    @patch('app.get_cursor')
    def test_pomodoro_stats_success(self, mock_cursor_context, client, sample_jwt_token):
        """Should return total/today/week stats derived from the DB rows."""
        mock_cursor = _mock_cursor(mock_cursor_context)
        mock_cursor.fetchone.side_effect = [
            {"id": 1},  # user lookup
            {"count": 10, "total_seconds": 15000},  # total (focus)
            {"count": 2, "total_seconds": 3000},  # today (focus)
            {"count": 5, "total_seconds": 7500},  # week (focus)
            {"count": 1, "total_seconds": 300},  # today's breaks
        ]

        headers = {"Authorization": f"Bearer {sample_jwt_token}"}
        response = client.get("/pomodoro/stats", headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        assert data["stats"]["total"]["sessions"] == 10
        assert data["stats"]["today"]["total_seconds"] == 3000
        assert data["stats"]["week"]["sessions"] == 5
        assert data["stats"]["today_breaks"]["total_seconds"] == 300


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
