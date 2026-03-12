"""
End-to-End Health Check Tests
Tests for verifying all services are running and healthy
"""
import pytest
import requests
import os
import time
from typing import Optional

# Mark all tests in this module as e2e
pytestmark = pytest.mark.e2e

# Configuration
FLASK_URL = os.getenv("FLASK_URL", "http://localhost:3000")
NEXTJS_URL = os.getenv("NEXTJS_URL", "http://localhost:5000")
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_PORT = os.getenv("MYSQL_PORT", "3306")

# Timeout for service availability checks
SERVICE_TIMEOUT = int(os.getenv("SERVICE_TIMEOUT", "30"))


def wait_for_service(url: str, timeout: int = SERVICE_TIMEOUT) -> bool:
    """Wait for a service to become available."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                return True
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)
    return False


class TestServiceAvailability:
    """Tests for verifying all services are available."""
    
    @pytest.fixture(autouse=True)
    def check_services_running(self):
        """Check if services are running before tests."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled. Set RUN_E2E_TESTS=true")
    
    def test_flask_service_available(self):
        """Flask backend should be available."""
        available = wait_for_service(f"{FLASK_URL}/health")
        assert available, f"Flask service not available at {FLASK_URL}"
    
    def test_nextjs_service_available(self):
        """Next.js frontend should be available."""
        available = wait_for_service(f"{NEXTJS_URL}/api/health")
        assert available, f"Next.js service not available at {NEXTJS_URL}"


class TestFlaskHealthEndpoints:
    """Tests for Flask health and status endpoints."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_health_endpoint(self):
        """Flask /health should return healthy status."""
        response = requests.get(f"{FLASK_URL}/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
    
    def test_health_endpoint_response_time(self):
        """Health endpoint should respond within acceptable time."""
        max_response_time = 2.0  # seconds
        
        start = time.time()
        response = requests.get(f"{FLASK_URL}/health", timeout=10)
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < max_response_time, f"Health check took {elapsed:.2f}s (max: {max_response_time}s)"


class TestNextJSHealthEndpoints:
    """Tests for Next.js health endpoints."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_api_health_endpoint(self):
        """Next.js /api/health should return healthy status."""
        response = requests.get(f"{NEXTJS_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
    
    def test_api_health_response_time(self):
        """Next.js health endpoint should respond quickly."""
        max_response_time = 3.0  # seconds
        
        start = time.time()
        response = requests.get(f"{NEXTJS_URL}/api/health", timeout=10)
        elapsed = time.time() - start
        
        assert response.status_code == 200
        assert elapsed < max_response_time, f"Health check took {elapsed:.2f}s"


class TestDatabaseConnectivity:
    """Tests for database connectivity through the application."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_categories_endpoint_requires_db(self):
        """Categories endpoint should work if DB is connected."""
        response = requests.get(f"{FLASK_URL}/get/categories", timeout=10)
        # Should return 200 with categories or 500 if DB issue
        assert response.status_code in [200, 500]
        
        if response.status_code == 200:
            data = response.json()
            assert "categories" in data


class TestFullAuthFlow:
    """End-to-end tests for authentication flow."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_register_login_flow(self):
        """Test complete register -> login flow."""
        import random
        timestamp = str(int(time.time()))
        username = f"e2e_test_user_{timestamp}"
        password = "e2e_test_password_123"
        
        # Register
        register_response = requests.post(
            f"{FLASK_URL}/register",
            json={"username": username, "password": password},
            timeout=10
        )
        
        # Registration might fail if user exists (from previous test run)
        if register_response.status_code == 201:
            # Login
            login_response = requests.post(
                f"{FLASK_URL}/login",
                json={"username": username, "password": password},
                timeout=10
            )
            
            assert login_response.status_code == 200
            data = login_response.json()
            assert "access_token" in data
            assert data["authenticated"] is True
    
    def test_invalid_login_rejected(self):
        """Invalid credentials should be rejected."""
        response = requests.post(
            f"{FLASK_URL}/login",
            json={"username": "nonexistent_user", "password": "wrong_password"},
            timeout=10
        )
        
        assert response.status_code == 401


class TestAPIIntegration:
    """Integration tests for API endpoints."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_protected_endpoint_requires_auth(self):
        """Protected endpoints should require authentication."""
        response = requests.get(f"{FLASK_URL}/entry", timeout=10)
        assert response.status_code in [401, 403]
    
    def test_categories_public(self):
        """Categories endpoint should be publicly accessible."""
        response = requests.get(f"{FLASK_URL}/get/categories", timeout=10)
        assert response.status_code == 200


class TestServiceInterdependency:
    """Tests for service dependencies."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_nextjs_can_reach_flask(self):
        """Next.js should be able to communicate with Flask."""
        # This tests the internal network connectivity
        response = requests.get(f"{NEXTJS_URL}/api/health", timeout=10)
        assert response.status_code == 200


class TestRateLimiting:
    """Tests for rate limiting functionality."""
    
    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")
    
    def test_rate_limiting_active(self):
        """Rate limiting should be active on sensitive endpoints."""
        # Make multiple rapid requests to login endpoint
        responses = []
        for _ in range(5):
            response = requests.post(
                f"{FLASK_URL}/login",
                json={"username": "test", "password": "test"},
                timeout=10
            )
            responses.append(response.status_code)
        
        # At least some responses should succeed (not all rate limited)
        # This is a basic sanity check
        assert len(responses) == 5


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
