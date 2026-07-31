"""
Flask Backend Integration Tests
Tests for the Flask API endpoints with database integration
"""
import pytest
import sys
import os
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
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
    def test_create_new_category(self, client, auth_token):
        """Should create a new category in database."""
        if not auth_token:
            pytest.skip("Authentication failed")
        category_name = f"Test Category {datetime.now().timestamp()}"
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = client.post("/category", json={"name": category_name}, headers=headers)

        assert response.status_code in [200, 201]
        data = response.get_json()
        assert "category" in data or "message" in data


class TestTimeEntryIntegration:
    """Integration tests for time entries."""
    
    @pytest.mark.integration
    def test_create_time_entry(self, registered_user, auth_token, client):
        """Should create a time entry in database."""
        if not registered_user or not auth_token:
            pytest.skip("User registration or login failed")

        headers = {"Authorization": f"Bearer {auth_token}"}
        category_name = "Work"
        client.post("/category", json={"name": category_name}, headers=headers)

        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)

        response = client.post("/entry/create", headers=headers, json={
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
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

        headers = {"Authorization": f"Bearer {auth_token}"}
        category_name = "Work"
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)

        create_response = client.post("/entry/create", headers=headers, json={
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        })
        
        if create_response.status_code != 201:
            pytest.skip("Failed to create entry for update test")

        entry_id = create_response.get_json()["entry"]["id"]
        
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

        headers = {"Authorization": f"Bearer {auth_token}"}
        category_name = "Work"
        start_time = datetime.now(timezone.utc)
        end_time = start_time + timedelta(hours=1)

        create_response = client.post("/entry/create", headers=headers, json={
            "category": category_name,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        })

        if create_response.status_code != 201:
            pytest.skip("Failed to create entry for delete test")

        entry_id = create_response.get_json()["entry"]["id"]
        
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
    def test_create_finance_category(self, client, auth_token):
        """Should create a new finance category."""
        if not auth_token:
            pytest.skip("Authentication failed")
        category_name = f"Finance Test {datetime.now().timestamp()}"
        headers = {"Authorization": f"Bearer {auth_token}"}
        response = client.post("/finance/category", json={"name": category_name}, headers=headers)

        try:
            assert response.status_code in [200, 201]
        finally:
            # finance_categories is global and has no delete endpoint, so a
            # category created here would otherwise pile up in the database and
            # show in every user's category picker, one more on every run.
            with get_cursor() as cursor:
                cursor.execute(
                    "DELETE FROM finance_categories WHERE name = %s", (category_name,)
                )


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


class TestBatchGenerateIntegration:
    """Integration tests for the finance batch generator."""

    GENERATE_PAYLOAD = {
        "frequency": "monthly",
        "day": 31,
        "start_date": "2024-01-15",
        "end_date": "2024-06-30",
        "entries": [
            {"category": "Bills", "product_name": "Rent", "price": 1000.00},
        ],
    }

    @pytest.mark.integration
    def test_preview_returns_rows_without_writing(self, registered_user, auth_token, client):
        """Preview must return the generated rows but insert nothing."""
        if not auth_token:
            pytest.skip("Authentication failed")

        headers = {"Authorization": f"Bearer {auth_token}"}
        product_name = f"PreviewOnly_{int(datetime.now().timestamp())}"

        payload = {**self.GENERATE_PAYLOAD, "preview": True}
        payload["entries"] = [
            {"category": "Bills", "product_name": product_name, "price": 10.0}
        ]

        response = client.post("/finance/batch-generate", headers=headers, json=payload)
        assert response.status_code == 200
        data = response.get_json()
        assert data["preview"] is True
        assert data["count"] == 6, f"expected 6 monthly rows, got {data['count']}"
        assert len(data["rows"]) == 6

        # day 31 clamped to the last day of shorter months
        purchase_dates = sorted(row["purchase_date"][:10] for row in data["rows"])
        assert purchase_dates == [
            "2024-01-31", "2024-02-29", "2024-03-31",
            "2024-04-30", "2024-05-31", "2024-06-30",
        ]

        # nothing should have been written
        listing = client.get("/finance", headers=headers)
        assert listing.status_code == 200
        names = [e["product_name"] for e in listing.get_json()["entries"]]
        assert product_name not in names

    @pytest.mark.integration
    def test_generation_inserts_planned_entries(self, registered_user, auth_token, client):
        """A non-preview request must persist one entry per occurrence."""
        if not auth_token:
            pytest.skip("Authentication failed")

        headers = {"Authorization": f"Bearer {auth_token}"}
        product_name = f"GenTest_{int(datetime.now().timestamp())}"

        payload = {
            "frequency": "monthly",
            "day": 1,
            "start_date": "2024-03-01",
            "end_date": "2024-05-01",
            "status": "planned",
            "entries": [
                {"category": "Bills", "product_name": product_name, "price": 5.0}
            ],
        }

        response = client.post("/finance/batch-generate", headers=headers, json=payload)
        assert response.status_code == 200
        data = response.get_json()
        assert data["success"] == 3
        assert data["failed"] == 0

        listing = client.get("/finance", headers=headers)
        assert listing.status_code == 200
        generated = [
            e for e in listing.get_json()["entries"]
            if e["product_name"] == product_name
        ]
        assert len(generated) == 3
        assert all(e["status"] == "planned" for e in generated)
        generated_dates = sorted(
            parsedate_to_datetime(e["purchase_date"]).date().isoformat()
            for e in generated
        )
        assert generated_dates == [
            "2024-03-01", "2024-04-01", "2024-05-01",
        ]

    @pytest.mark.integration
    def test_last_day_of_month_option(self, registered_user, auth_token, client):
        """day=-1 should generate on the last day of every month in range."""
        if not auth_token:
            pytest.skip("Authentication failed")

        headers = {"Authorization": f"Bearer {auth_token}"}

        payload = {
            "frequency": "monthly",
            "day": -1,
            "start_date": "2024-01-01",
            "end_date": "2024-03-31",
            "preview": True,
            "entries": [
                {"category": "Bills", "product_name": "LastDay", "price": 1.0}
            ],
        }

        response = client.post("/finance/batch-generate", headers=headers, json=payload)
        assert response.status_code == 200
        data = response.get_json()
        assert data["count"] == 3
        assert sorted(row["purchase_date"][:10] for row in data["rows"]) == [
            "2024-01-31", "2024-02-29", "2024-03-31",
        ]


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-m", "integration"])
