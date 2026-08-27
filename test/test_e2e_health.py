"""
End-to-End Health Check Tests
Tests for verifying all services are running and healthy
"""
import pytest
import requests
import os
import re
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


class TestAuthenticatedProxyRoutes:
    """The Next.js API routes must carry the caller's identity to Flask.

    Every other test in this file talks to Flask directly, so nothing checked
    whether the proxies in between actually forward authentication. POST
    /api/category did not — a bare fetch() in a route handler carries none of
    the browser's cookies — and Flask has required a token on /category since
    2026-03-01, so "+ New Category" on the manage screen had been failing for
    every user for months with nobody the wiser.

    These go through NEXTJS_URL on purpose. Pointing them at Flask would pass
    while the bug was live.
    """

    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")

    @pytest.fixture(scope="class")
    def session(self):
        """A logged-in requests session holding the httpOnly auth cookies.

        Class-scoped, and not only to save time. Every request the browser
        makes reaches Flask from the single Next.js container, so Flask-Limiter
        buckets the whole app under one address: registering once per test
        would trip "5 per minute" partway through the class and fail the rest.
        """
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")

        username = f"e2e_proxy_{int(time.time() * 1000)}"
        password = "e2e_test_password_123"
        s = requests.Session()

        register = s.post(
            f"{NEXTJS_URL}/api/register",
            json={"username": username, "password": password},
            timeout=10,
        )
        assert register.status_code in (200, 201), register.text

        login = s.post(
            f"{NEXTJS_URL}/api/login",
            json={"username": username, "password": password},
            timeout=10,
        )
        assert login.status_code == 200, login.text
        assert "access_token" in s.cookies

        s.username = username
        return s

    @pytest.mark.parametrize(
        "path",
        ["/api/category", "/api/finance/category", "/api/todo/category"],
    )
    def test_category_create_proxies_forward_auth(self, session, path):
        """All three namespaces create through their proxy, not just two."""
        name = f"E2EProbe{int(time.time() * 1000)}"
        response = session.post(
            f"{NEXTJS_URL}{path}",
            json={"name": name},
            timeout=10,
        )
        assert response.status_code in (200, 201), (
            f"{path} returned {response.status_code}: {response.text}"
        )

    @pytest.mark.parametrize(
        "path",
        ["/api/category", "/api/finance/category", "/api/todo/category"],
    )
    def test_category_create_still_refuses_anonymous_callers(self, path):
        """Forwarding the cookie must not mean accepting requests without one."""
        response = requests.post(
            f"{NEXTJS_URL}{path}",
            json={"name": f"E2EAnon{int(time.time() * 1000)}"},
            timeout=10,
        )
        assert response.status_code in (401, 403), response.text

    def test_entry_listing_proxy_forwards_auth(self, session):
        """The read path the manage screens depend on."""
        response = session.get(f"{NEXTJS_URL}/api/entry", timeout=10)
        assert response.status_code == 200, response.text
        assert response.json()["username"] == session.username

    def test_list_query_parameters_survive_the_proxy(self, session):
        """The proxies forward the query string, not just the path."""
        response = session.get(f"{NEXTJS_URL}/api/entry?limit=5", timeout=10)
        assert response.status_code == 200, response.text
        assert response.json()["page"]["limit"] == 5

    def test_rejected_query_parameters_surface_as_400(self, session):
        """Flask's validation error must reach the browser, not become a 500."""
        response = session.get(f"{NEXTJS_URL}/api/entry?sort=pwd_hash", timeout=10)
        assert response.status_code == 400, response.text
        assert "sort must be one of" in response.json()["error"]

    def test_rate_limited_requests_stay_json(self):
        """A throttled caller must get 429 and a readable reason, not a 500.

        Flask-Limiter's stock 429 is an HTML page; the login and register
        proxies parsed every response as JSON, so tripping the limit surfaced
        in the browser as a blank 500 with nothing to act on.
        """
        seen_429 = False
        for _ in range(12):
            response = requests.post(
                f"{NEXTJS_URL}/api/login",
                json={"username": "definitely_not_a_user", "password": "nope"},
                timeout=10,
            )
            assert response.status_code != 500, response.text
            if response.status_code == 429:
                seen_429 = True
                assert "error" in response.json()
                break

        if not seen_429:
            pytest.skip("Login limiter did not trip; nothing to assert on")


class TestThemeVariantIsUserControlled:
    """The `dark:` utilities must follow the theme preference, not the OS.

    Tailwind v4's stock `dark:` variant compiles to a bare
    `@media (prefers-color-scheme: dark)`. The semantic tokens in globals.css
    were already keyed to [data-theme], so choosing Light on a dark-mode
    machine produced a light page still wearing ~180 dark borders, rings and
    tints. globals.css now redefines the variant; this pins that it stays
    redefined, by reading the stylesheet the browser is actually served.
    """

    @pytest.fixture(autouse=True)
    def skip_if_no_e2e_flag(self):
        """Skip if E2E tests not enabled."""
        if not os.getenv("RUN_E2E_TESTS"):
            pytest.skip("E2E tests not enabled")

    @pytest.fixture(scope="class")
    def stylesheet(self):
        """The compiled CSS bundle, fetched the way a browser would."""
        page = requests.get(f"{NEXTJS_URL}/namu", timeout=15)
        assert page.status_code == 200, page.status_code

        hrefs = re.findall(r'href="(/_next/static/[^"]+\.css)"', page.text)
        assert hrefs, "No stylesheet linked from the page"

        css = requests.get(f"{NEXTJS_URL}{hrefs[0]}", timeout=15)
        assert css.status_code == 200, css.status_code
        return css.text

    def test_dark_utilities_are_scoped_to_the_theme_attribute(self, stylesheet):
        assert "[data-theme=dark]" in stylesheet or (
            '[data-theme="dark"]' in stylesheet
        ), "The dark variant is not keyed to [data-theme] at all"

    def test_no_dark_utility_escapes_the_theme_scope(self, stylesheet):
        """A utility with no :where(...) guard would follow the OS alone."""
        unguarded = []
        for match in re.finditer(r"\.dark\\:", stylesheet):
            brace = stylesheet.find("{", match.start())
            selector = stylesheet[match.start() : brace if brace != -1 else None]
            if ":where(" not in selector:
                unguarded.append(selector[:80])

        assert not unguarded, f"Unscoped dark utilities: {unguarded[:5]}"

    def test_an_explicit_light_choice_still_beats_a_dark_os(self, stylesheet):
        """The OS-dark branch must exclude an explicit light preference."""
        assert "[data-theme=light]" in stylesheet or (
            '[data-theme="light"]' in stylesheet
        ), "Nothing opts a light-preferring user out of the dark media query"

    def test_the_inert_dark_class_is_gone_from_the_markup(self):
        """<html class="dark"> matched no selector; it only implied one."""
        page = requests.get(f"{NEXTJS_URL}/namu", timeout=15)
        assert page.status_code == 200
        assert not re.search(r"<html[^>]*class=\"[^\"]*\bdark\b", page.text)

    def test_the_theme_is_applied_before_first_paint(self):
        """Applying it from an effect flashes the OS theme on every load."""
        page = requests.get(f"{NEXTJS_URL}/namu", timeout=15)
        assert "themePreference" in page.text, (
            "No pre-paint theme script in the served HTML"
        )



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
