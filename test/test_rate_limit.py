"""
Rate-limit keying tests.

Every other tier runs with limiting switched off — the unit and integration
tiers because they import the app in-process with RATELIMIT_ENABLED=false, the
e2e tier because the flask service is now configured the same way. That is what
makes those tiers stable, and it means this file is the only coverage limiting
has. It therefore turns the limiter on deliberately rather than inheriting an
ambient setting.

What is being pinned is the keying, not the numbers. The defect these tests
exist for is that every caller shared one bucket: because the browser reaches
Flask through a single Next.js container, `get_remote_address` returned the same
value for the whole user base, so one person's activity throttled everyone.
"""
import os
import sys

import bcrypt
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-min-32-chars")

from app import app, limiter  # noqa: E402
from rate_limit import (  # noqa: E402
    address_key,
    client_address,
    limiter_key,
    login_key,
    request_from_trusted_proxy,
    reset_failed_logins,
)

PROXY_SECRET = "test-internal-proxy-secret"


@pytest.fixture
def limited_app(monkeypatch):
    """The app with rate limiting on and a clean bucket store.

    Restores whatever the surrounding suite had configured; other modules in
    this suite rely on limiting being off, and pytest gives no ordering
    guarantee about who runs after us.
    """
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-unit-tests-min-32-chars"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    was_enabled = limiter.enabled
    previous_config = app.config.get("RATELIMIT_ENABLED")

    # app.py builds the limiter fully and then switches it off, so its storage
    # and request hooks already exist and flipping this back on is enough. Were
    # it constructed disabled instead, it could not be initialised here at all:
    # Flask rejects a before_request hook after the first request, so this would
    # pass alone and fail in a full-suite run.
    app.config["RATELIMIT_ENABLED"] = True
    limiter.enabled = True
    limiter.reset()
    # Failed logins are counted in their own store, outside the extension, so
    # limiter.reset() does not touch them.
    reset_failed_logins()

    monkeypatch.setenv("INTERNAL_PROXY_SECRET", PROXY_SECRET)
    # The failed-login throttle reads this per call rather than going through
    # the extension, so it needs turning on separately from limiter.enabled.
    monkeypatch.setenv("RATELIMIT_ENABLED", "true")

    yield app

    limiter.reset()
    reset_failed_logins()
    # Every limit is exempt while `enabled` is false, so the tiers that run
    # after this module are unaffected by having borrowed the limiter.
    limiter.enabled = was_enabled
    app.config["RATELIMIT_ENABLED"] = previous_config


@pytest.fixture
def client(limited_app):
    with limited_app.test_client() as client:
        yield client


def token_for(username):
    from flask_jwt_extended import create_access_token
    with app.app_context():
        return create_access_token(identity=username)


def auth(username):
    return {"Authorization": f"Bearer {token_for(username)}"}


def mock_login_cursor(user_row):
    """Stand in for get_cursor, yielding a cursor that finds `user_row`."""
    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchone = MagicMock(return_value=user_row)
    return cursor


class TestDefaultLimitIsPerUser:
    """The default 20/minute must bucket by account, not by connecting address."""

    def test_one_user_exhausting_the_limit_does_not_block_another(self, client):
        alice = auth("alice")
        for _ in range(20):
            assert client.get("/protected", headers=alice).status_code == 200

        # Alice is now out of budget...
        assert client.get("/protected", headers=alice).status_code == 429

        # ...and Bob, arriving from the very same address, is untouched. Before
        # the keying change this assertion failed: one bucket served everyone.
        assert client.get("/protected", headers=auth("bob")).status_code == 200

    def test_throttled_response_is_json(self, client):
        alice = auth("alice")
        for _ in range(21):
            response = client.get("/protected", headers=alice)

        assert response.status_code == 429
        assert response.is_json
        assert "error" in response.get_json()


class TestFailedLoginThrottle:
    """Guessing is throttled per account, without ever locking its owner out."""

    def test_wrong_guesses_throttle_that_account(self, client):
        with patch("app.get_cursor", return_value=mock_login_cursor(None)):
            for _ in range(10):
                response = client.post(
                    "/login", json={"username": "victim", "password": "wrong"}
                )
                assert response.status_code == 401

            assert client.post(
                "/login", json={"username": "victim", "password": "wrong"}
            ).status_code == 429

            # A different account is unaffected — the whole point. Keying on the
            # address would have locked every user out of logging in here.
            assert client.post(
                "/login", json={"username": "bystander", "password": "wrong"}
            ).status_code == 401

    def test_the_owner_gets_in_after_the_budget_is_spent(self, client):
        """The account-lockout DoS this endpoint must not have.

        Ten wrong guesses is something any stranger can produce against a
        username they picked. If that could stop the real owner logging in, the
        throttle would be a denial-of-service tool aimed at whoever it names.

        A per-username `@limiter.limit(deduct_when=...)` fails exactly here:
        deduct_when governs whether a request is charged, but the check still
        runs before the view, so the emptied bucket refuses the correct password
        too. Hence the in-view throttle, consulted only after a password is
        already known to be wrong.
        """
        password = "correct-horse"
        user_row = {
            "id": 1,
            "username": "victim",
            "pwd_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()),
        }

        with patch("app.get_cursor", return_value=mock_login_cursor(None)):
            for _ in range(11):
                client.post("/login", json={"username": "victim", "password": "no"})

        with patch("app.get_cursor", return_value=mock_login_cursor(user_row)):
            response = client.post(
                "/login", json={"username": "victim", "password": password}
            )

        assert response.status_code == 200, response.get_json()
        assert response.get_json()["access_token"]

    def test_repeated_successful_logins_are_never_throttled(self, client):
        password = "correct-horse"
        user_row = {
            "id": 1,
            "username": "alice",
            "pwd_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()),
        }

        with patch("app.get_cursor", return_value=mock_login_cursor(user_row)):
            for _ in range(15):
                response = client.post(
                    "/login", json={"username": "alice", "password": password}
                )
                assert response.status_code == 200

    def test_username_case_does_not_buy_a_second_budget(self, client):
        with patch("app.get_cursor", return_value=mock_login_cursor(None)):
            for _ in range(10):
                client.post("/login", json={"username": "victim", "password": "x"})

            assert client.post(
                "/login", json={"username": "VICTIM", "password": "x"}
            ).status_code == 429

    def test_a_throttled_attempt_says_so_in_json(self, client):
        with patch("app.get_cursor", return_value=mock_login_cursor(None)):
            for _ in range(11):
                response = client.post(
                    "/login", json={"username": "victim", "password": "x"}
                )

        assert response.status_code == 429
        assert "error" in response.get_json()


class TestForwardedAddressNeedsTheSecret:
    """Flask may only believe X-Forwarded-For from something holding the secret."""

    def test_forwarded_address_is_used_when_the_secret_matches(self, limited_app):
        with limited_app.test_request_context(
            headers={
                "X-Forwarded-For": "203.0.113.7",
                "X-Proxy-Auth": PROXY_SECRET,
            }
        ):
            assert request_from_trusted_proxy() is True
            assert client_address() == "203.0.113.7"

    def test_forwarded_address_is_ignored_without_the_secret(self, limited_app):
        # Flask's port is published to the host, so this is a request an
        # outsider can make. Honouring it would let them mint a fresh bucket per
        # request simply by varying the header.
        with limited_app.test_request_context(
            headers={"X-Forwarded-For": "203.0.113.7"}
        ):
            assert request_from_trusted_proxy() is False
            assert client_address() != "203.0.113.7"

    def test_a_wrong_secret_is_ignored(self, limited_app):
        with limited_app.test_request_context(
            headers={
                "X-Forwarded-For": "203.0.113.7",
                "X-Proxy-Auth": "not-the-secret",
            }
        ):
            assert client_address() != "203.0.113.7"

    def test_forwarding_is_off_when_no_secret_is_configured(
        self, limited_app, monkeypatch
    ):
        monkeypatch.delenv("INTERNAL_PROXY_SECRET", raising=False)
        with limited_app.test_request_context(
            headers={"X-Forwarded-For": "203.0.113.7", "X-Proxy-Auth": ""}
        ):
            assert request_from_trusted_proxy() is False

    def test_only_the_leftmost_forwarded_address_is_taken(self, limited_app):
        # client, proxy1, proxy2 — anything but the first was appended by a hop
        # and would bucket unrelated callers together again.
        with limited_app.test_request_context(
            headers={
                "X-Forwarded-For": "203.0.113.7, 198.51.100.1, 198.51.100.2",
                "X-Proxy-Auth": PROXY_SECRET,
            }
        ):
            assert client_address() == "203.0.113.7"


class TestKeyFunctions:
    """The keys themselves, independent of any limit."""

    def test_authenticated_requests_key_on_the_user(self, limited_app):
        with limited_app.test_request_context(headers=auth("alice")):
            assert limiter_key() == "user:alice"

    def test_anonymous_requests_key_on_the_address(self, limited_app):
        with limited_app.test_request_context():
            assert limiter_key().startswith("ip:")

    def test_an_unusable_token_falls_back_to_the_address(self, limited_app):
        # Rejecting it is the route's job, via @jwt_required(). Here a garbage
        # token must simply not raise out of the key function, which runs before
        # any route code and would otherwise 500 the request.
        with limited_app.test_request_context(
            headers={"Authorization": "Bearer not-a-real-token"}
        ):
            assert limiter_key().startswith("ip:")

    def test_register_keys_on_the_address_not_the_submitted_name(self, limited_app):
        # An attacker picks the username field freely; keying on it would hand
        # out a new budget per attempt.
        with limited_app.test_request_context(
            "/register", method="POST", json={"username": "whoever", "password": "x"}
        ):
            assert address_key().startswith("ip:")

    def test_login_keys_on_the_attempted_username(self, limited_app):
        with limited_app.test_request_context(
            "/login", method="POST", json={"username": "  Alice  ", "password": "x"}
        ):
            assert login_key() == "login:alice"

    def test_login_with_a_malformed_body_keys_on_the_address(self, limited_app):
        with limited_app.test_request_context(
            "/login", method="POST", data="not json", content_type="application/json"
        ):
            assert login_key().startswith("login-malformed:")
