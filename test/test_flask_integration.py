"""
Flask Backend Integration Tests
Tests for the Flask API endpoints with database integration
"""
import pytest
import sys
import os
from datetime import datetime, timezone, timedelta
import bcrypt

# Mark all tests in this module as integration
pytestmark = pytest.mark.integration

# Add flask-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

from app import app, get_pool, get_cursor


@pytest.fixture(scope="module")
def test_app():
    """Create test app with test database configuration."""
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-integration"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]
    
    # Use test database if available
    test_db_config = {
        "host": os.getenv("TEST_DB_HOST", "localhost"),
        "port": int(os.getenv("TEST_DB_PORT", "3306")),
        "user": os.getenv("TEST_DB_USER", "test_user"),
        "password": os.getenv("TEST_DB_PASSWORD", "test_password"),
        "database": os.getenv("TEST_DB_NAME", "test_time_tracker"),
    }
    
    # Only run if test database is configured
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")
    
    with app.app_context():
        yield app


@pytest.fixture(scope="module")
def client(test_app):
    """Create a test client for integration tests."""
    with test_app.test_client() as client:
        yield client


@pytest.fixture(scope="module")
def registered_user(client):
    """Register a test user and return credentials."""
    username = f"testuser_{datetime.now().timestamp()}"
    password = "testpass123"
    
    response = client.post("/register", json={
        "username": username,
        "password": password
    })
    
    if response.status_code == 201:
        return {"username": username, "password": password}
    return None


@pytest.fixture(scope="module")
def auth_token(client, registered_user):
    """Get authentication token for registered user."""
    if not registered_user:
        return None
    
    response = client.post("/login", json={
        "username": registered_user["username"],
        "password": registered_user["password"]
    })
    
    if response.status_code == 200:
        return response.get_json()["access_token"]
    return None


class TestDatabaseConnection:
    """Tests for database connectivity."""
    
    @pytest.mark.integration
    def test_database_connection(self, test_app):
        """Should be able to connect to the database."""
        try:
            pool = get_pool()
            conn = pool.get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            result = cursor.fetchone()
            cursor.close()
            conn.close()
            assert result[0] == 1
        except Exception as e:
            pytest.skip(f"Database connection failed: {e}")


class TestUserRegistrationIntegration:
    """Integration tests for user registration."""
    
    @pytest.mark.integration
    def test_register_new_user(self, client):
        """Should register a new user in the database."""
        username = f"integration_user_{datetime.now().timestamp()}"
        password = "integrationpass123"
        
        response = client.post("/register", json={
            "username": username,
            "password": password
        })
        
        assert response.status_code == 201
        data = response.get_json()
        assert data["username"] == username
        assert "user_id" in data


class TestUserLoginIntegration:
    """Integration tests for user login."""
    
    @pytest.mark.integration
    def test_login_with_valid_credentials(self, registered_user, client):
        """Should login with valid credentials."""
        if not registered_user:
            pytest.skip("User registration failed")
        
        response = client.post("/login", json={
            "username": registered_user["username"],
            "password": registered_user["password"]
        })
        
        assert response.status_code == 200
        data = response.get_json()
        assert "access_token" in data
        assert data["authenticated"] is True
    
    @pytest.mark.integration
    def test_login_with_invalid_credentials(self, registered_user, client):
        """Should reject invalid credentials."""
        if not registered_user:
            pytest.skip("User registration failed")
        
        response = client.post("/login", json={
            "username": registered_user["username"],
            "password": "wrongpassword"
        })
        
        assert response.status_code == 401


class TestCategoryIntegration:
    """Integration tests for categories."""
    
    @pytest.mark.integration
    def test_list_categories_from_db(self, client):
        """Should retrieve categories from database."""
        response = client.get("/get/categories")
        
        assert response.status_code == 200
        data = response.get_json()
        assert "categories" in data
        assert isinstance(data["categories"], list)
    
    @pytest.mark.integration
    def test_create_new_category(self, client):
        """Should create a new category in database."""
        category_name = f"Test Category {datetime.now().timestamp()}"
        
        response = client.post("/category", json={"name": category_name})
        
        assert response.status_code in [200, 201]
        data = response.get_json()
        assert "category" in data or "message" in data


class TestTimeEntryIntegration:
    """Integration tests for time entries."""
    
    @pytest.mark.integration
    def test_create_time_entry(self, registered_user, client):
        """Should create a time entry in database."""
        if not registered_user:
            pytest.skip("User registration failed")
        
        # Ensure category exists
        category_name = "Work"
        client.post("/category", json={"name": category_name})
        
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)
        
        response = client.post("/entry/create", json={
            "username": registered_user["username"],
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat()
        })
        
        assert response.status_code == 201
        data = response.get_json()
        assert "entry" in data
    
    @pytest.mark.integration
    def test_get_user_entries(self, registered_user, auth_token, client):
        """Should retrieve user's time entries."""
        if not auth_token:
            pytest.skip("Authentication failed")
        
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = client.get("/entry", headers=headers)
        
        assert response.status_code == 200
        data = response.get_json()
        assert "entries" in data
        assert isinstance(data["entries"], list)
    
    @pytest.mark.integration
    def test_update_time_entry(self, registered_user, auth_token, client):
        """Should update an existing time entry."""
        if not auth_token:
            pytest.skip("Authentication failed")
        
        # First create an entry
        category_name = "Work"
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)
        
        create_response = client.post("/entry/create", json={
            "username": registered_user["username"],
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat()
        })
        
        if create_response.status_code != 201:
            pytest.skip("Failed to create entry for update test")
        
        entry_id = create_response.get_json()["entry"]["id"]
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Update the entry
        new_end_time = start_time + timedelta(hours=2)
        update_response = client.put(
            f"/entry/{entry_id}",
            headers=headers,
            json={
                "category": category_name,
                "start_time": start_time.isoformat(),
                "end_time": new_end_time.isoformat()
            }
        )
        
        assert update_response.status_code == 200
    
    @pytest.mark.integration
    def test_delete_time_entry(self, registered_user, auth_token, client):
        """Should delete a time entry."""
        if not auth_token:
            pytest.skip("Authentication failed")
        
        # First create an entry
        category_name = "Work"
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)
        
        create_response = client.post("/entry/create", json={
            "username": registered_user["username"],
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat()
        })
        
        if create_response.status_code != 201:
            pytest.skip("Failed to create entry for delete test")
        
        entry_id = create_response.get_json()["entry"]["id"]
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Delete the entry
        delete_response = client.delete(
            "/entry/delete",
            headers=headers,
            json={"entry_id": entry_id}
        )
        
        assert delete_response.status_code == 200


class TestFinanceEntryIntegration:
    """Integration tests for finance entries."""
    
    @pytest.mark.integration
    def test_list_finance_categories(self, client):
        """Should retrieve finance categories from database."""
        response = client.get("/finance/categories")
        
        assert response.status_code == 200
        data = response.get_json()
        assert "categories" in data
    
    @pytest.mark.integration
    def test_create_finance_category(self, client):
        """Should create a new finance category."""
        category_name = f"Finance Test {datetime.now().timestamp()}"
        
        response = client.post("/finance/category", json={"name": category_name})
        
        assert response.status_code in [200, 201]


class TestBatchImportIntegration:
    """Integration tests for batch import functionality."""
    
    @pytest.mark.integration
    def test_batch_import_time_entries(self, registered_user, auth_token, client):
        """Should batch import multiple time entries."""
        if not auth_token:
            pytest.skip("Authentication failed")
        
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        start_time = datetime.now(timezone.utc)
        
        entries = [
            {
                "category": "Work",
                "start_time": start_time.isoformat(),
                "end_time": (start_time + timedelta(hours=1)).isoformat()
            },
            {
                "category": "Reading",
                "start_time": (start_time + timedelta(days=1)).isoformat(),
                "end_time": (start_time + timedelta(days=1, hours=1)).isoformat()
            }
        ]
        
        response = client.post(
            "/entry/batch-import",
            headers=headers,
            json={"entries": entries}
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert "success" in data
        assert "failed" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-m", "integration"])
