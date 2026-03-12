"""
Pytest configuration for the test suite
"""
import pytest
import os
import sys

# Set default environment variables for tests if not already set
# This ensures tests can run even without a .env file
if not os.getenv("JWT_SECRET_KEY"):
    os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-min-32-chars"

if not os.getenv("DB_HOST"):
    os.environ["DB_HOST"] = "localhost"

if not os.getenv("DB_PORT"):
    os.environ["DB_PORT"] = "3306"

if not os.getenv("DB_NAME"):
    os.environ["DB_NAME"] = "time_tracker"

if not os.getenv("DB_USER"):
    os.environ["DB_USER"] = "app_user"

if not os.getenv("DB_PASSWORD"):
    os.environ["DB_PASSWORD"] = "test_password"

if not os.getenv("TOKEN_DURATION_HOURS"):
    os.environ["TOKEN_DURATION_HOURS"] = "48"


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


def pytest_collection_modifyitems(config, items):
    """Modify test collection to skip certain tests by default."""
    # Skip integration tests unless explicitly requested
    if not os.getenv("RUN_INTEGRATION_TESTS"):
        skip_integration = pytest.mark.skip(
            reason="Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true"
        )
        for item in items:
            if "integration" in item.keywords:
                item.add_marker(skip_integration)

    # Skip e2e tests unless explicitly requested
    if not os.getenv("RUN_E2E_TESTS"):
        skip_e2e = pytest.mark.skip(
            reason="E2E tests not enabled. Set RUN_E2E_TESTS=true"
        )
        for item in items:
            if "e2e" in item.keywords:
                item.add_marker(skip_e2e)

    # Skip docker tests unless explicitly requested
    if not os.getenv("RUN_DOCKER_TESTS"):
        skip_docker = pytest.mark.skip(
            reason="Docker tests not enabled. Set RUN_DOCKER_TESTS=true"
        )
        for item in items:
            if "docker" in item.keywords:
                item.add_marker(skip_docker)


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
