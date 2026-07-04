"""
Pytest configuration for the test suite
"""
import pytest
import os

if not os.getenv("JWT_SECRET_KEY"):
    os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-min-32-chars"


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test (requires database)"
    )
    config.addinivalue_line(
        "markers", "e2e: mark test as an end-to-end test (requires running services)"
    )
    config.addinivalue_line(
        "markers", "docker: mark test as a Docker verification test"
    )


@pytest.fixture(scope="session")
def test_config():
    """Global test configuration."""
    return {
        "flask_url": os.getenv("FLASK_URL", "http://localhost:3000"),
        "nextjs_url": os.getenv("NEXTJS_URL", "http://localhost:5000"),
        "run_integration": os.getenv("RUN_INTEGRATION_TESTS") == "true",
        "run_e2e": os.getenv("RUN_E2E_TESTS") == "true",
        "run_docker": os.getenv("RUN_DOCKER_TESTS") == "true",
    }
