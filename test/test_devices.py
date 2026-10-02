"""
Device pairing tests (routes/devices.py)
========================================

The Namu Android app pairs once with a username and password, then
authenticates with a device token alone. These cover both sides against the
real database: the phone's (pair, check, unpair) and the web app's (list,
revoke), including that one user can never see or revoke another's phones.

Throttling of pairing attempts is covered in test_rate_limit.py, which is the
only module that runs with limiting switched on.

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_devices.py -v
"""
import hashlib
import os
import sys
import uuid

import pytest

pytestmark = pytest.mark.integration

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

from app import app, get_cursor  # noqa: E402

PASSWORD = "S3cur3P@ssw0rd!"


@pytest.fixture(scope="module")
def client():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-device-integration-64chars-long!!!!"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context(), app.test_client() as c:
        yield c


def _new_user(client):
    """Register a user and return (username, web auth headers)."""
    username = f"device_{uuid.uuid4().hex[:12]}"
    assert client.post(
        "/register", json={"username": username, "password": PASSWORD}
    ).status_code == 201
    login = client.post("/login", json={"username": username, "password": PASSWORD})
    assert login.status_code == 200
    return username, {"Authorization": f"Bearer {login.get_json()['access_token']}"}


@pytest.fixture
def alice(client):
    return _new_user(client)


@pytest.fixture
def bob(client):
    return _new_user(client)


def _pair(client, username, password=PASSWORD, device_name="Pixel 8"):
    return client.post(
        "/devices/pair",
        json={"username": username, "password": password, "device_name": device_name},
    )


def _device_auth(token):
    return {"Authorization": f"Device {token}"}


# ─── Pairing ──────────────────────────────────────────────────────────────────


class TestPairing:
    def test_pairing_returns_a_device_token(self, client, alice):
        username, _ = alice
        response = _pair(client, username)

        assert response.status_code == 201
        body = response.get_json()
        assert body["token"].startswith("namu_dev_")
        assert body["username"] == username
        assert body["name"] == "Pixel 8"
        assert isinstance(body["device_id"], int)

    def test_only_the_tokens_hash_is_stored(self, client, alice):
        username, _ = alice
        body = _pair(client, username).get_json()

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT token_hash FROM devices WHERE id = %s", (body["device_id"],)
            )
            stored = bytes(cursor.fetchone()["token_hash"])

        assert stored == hashlib.sha256(body["token"].encode()).digest()
        assert body["token"].encode() not in stored

    def test_each_pairing_gets_a_different_token(self, client, alice):
        username, _ = alice
        first = _pair(client, username).get_json()["token"]
        second = _pair(client, username).get_json()["token"]
        assert first != second

    def test_a_wrong_password_pairs_nothing(self, client, alice):
        username, web = alice
        response = _pair(client, username, password="not-the-password")

        assert response.status_code == 401
        assert response.get_json()["error"] == "Invalid username or password"
        assert client.get("/devices", headers=web).get_json()["devices"] == []

    def test_an_unknown_user_gets_the_same_answer(self, client):
        # Same wording as a wrong password, so pairing cannot be used to find
        # out which usernames exist.
        response = _pair(client, f"nobody_{uuid.uuid4().hex[:8]}")
        assert response.status_code == 401
        assert response.get_json()["error"] == "Invalid username or password"

    @pytest.mark.parametrize("payload", [
        {"username": "x", "password": "y"},
        {"username": "x", "password": "y", "device_name": "   "},
        {"username": "x", "password": "y", "device_name": 42},
        {"username": "x", "password": "y", "device_name": "a" * 101},
        {"password": "y", "device_name": "Pixel"},
    ], ids=["no-device-name", "blank-device-name", "non-string-device-name",
            "device-name-too-long", "no-username"])
    def test_invalid_payloads_are_refused(self, client, payload):
        response = client.post("/devices/pair", json=payload)
        assert response.status_code == 400

    def test_a_body_that_is_not_json_is_refused(self, client):
        response = client.post("/devices/pair", data="nope", content_type="text/plain")
        assert response.status_code == 400


# ─── The phone's side ─────────────────────────────────────────────────────────


class TestDeviceToken:
    def test_a_paired_device_can_check_its_pairing(self, client, alice):
        username, _ = alice
        paired = _pair(client, username).get_json()

        response = client.get("/devices/me", headers=_device_auth(paired["token"]))

        assert response.status_code == 200
        body = response.get_json()
        assert body["id"] == paired["device_id"]
        assert body["username"] == username
        assert body["revoked_at"] is None
        assert body["last_seen_at"].endswith("+00:00")

    def test_checking_records_when_the_device_was_seen(self, client, alice):
        username, _ = alice
        paired = _pair(client, username).get_json()
        client.get("/devices/me", headers=_device_auth(paired["token"]))

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT last_seen_at FROM devices WHERE id = %s", (paired["device_id"],)
            )
            assert cursor.fetchone()["last_seen_at"] is not None

    @pytest.mark.parametrize("header", [
        None,
        "Device ",
        "Device namu_dev_made-up-token",
        "Device not-even-the-right-prefix",
        "Bearer namu_dev_right-prefix-wrong-scheme",
    ], ids=["missing", "empty", "unknown-token", "wrong-prefix", "wrong-scheme"])
    def test_anything_but_a_valid_device_token_is_refused(self, client, header):
        headers = {"Authorization": header} if header else {}
        assert client.get("/devices/me", headers=headers).status_code == 401

    def test_a_web_login_token_is_not_a_device_token(self, client, alice):
        _, web = alice
        assert client.get("/devices/me", headers=web).status_code == 401

    def test_unpairing_from_the_phone_stops_the_token(self, client, alice):
        username, web = alice
        paired = _pair(client, username).get_json()
        auth = _device_auth(paired["token"])

        assert client.post("/devices/me/revoke", headers=auth).status_code == 200

        response = client.get("/devices/me", headers=auth)
        assert response.status_code == 401
        assert response.get_json()["error"] == "This device has been unpaired"
        listed = client.get("/devices", headers=web).get_json()["devices"]
        assert listed[0]["revoked_at"] is not None

    def test_deleting_the_account_stops_its_tokens(self, client, alice):
        username, _ = alice
        token = _pair(client, username).get_json()["token"]

        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user_id = cursor.fetchone()["id"]
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            for table in ("category", "finance_categories", "todo_categories", "todo_tags"):
                cursor.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))

        assert client.get("/devices/me", headers=_device_auth(token)).status_code == 401


# ─── The web app's side ───────────────────────────────────────────────────────


class TestWebManagement:
    def test_listing_shows_only_the_callers_devices(self, client, alice, bob):
        _pair(client, alice[0], device_name="Alice's phone")
        _pair(client, bob[0], device_name="Bob's phone")

        names = [d["name"] for d in client.get("/devices", headers=alice[1]).get_json()["devices"]]
        assert names == ["Alice's phone"]

    def test_listing_never_includes_a_token_or_its_hash(self, client, alice):
        _pair(client, alice[0])
        device = client.get("/devices", headers=alice[1]).get_json()["devices"][0]
        assert set(device) == {"id", "name", "created_at", "last_seen_at", "revoked_at"}

    def test_listing_needs_a_web_login(self, client, alice):
        token = _pair(client, alice[0]).get_json()["token"]
        assert client.get("/devices").status_code == 401
        # A device token is not a way in to the web endpoints either.
        assert client.get("/devices", headers=_device_auth(token)).status_code == 401

    def test_revoking_from_the_web_stops_the_token(self, client, alice):
        paired = _pair(client, alice[0]).get_json()

        response = client.post(
            f"/devices/{paired['device_id']}/revoke", headers=alice[1]
        )

        assert response.status_code == 200
        assert client.get(
            "/devices/me", headers=_device_auth(paired["token"])
        ).status_code == 401

    def test_revoking_twice_keeps_the_first_time(self, client, alice):
        paired = _pair(client, alice[0]).get_json()
        url = f"/devices/{paired['device_id']}/revoke"

        client.post(url, headers=alice[1])
        first = client.get("/devices", headers=alice[1]).get_json()["devices"][0]["revoked_at"]
        assert client.post(url, headers=alice[1]).status_code == 200
        second = client.get("/devices", headers=alice[1]).get_json()["devices"][0]["revoked_at"]

        assert first == second

    def test_another_users_device_is_not_found(self, client, alice, bob):
        """IDOR: Bob cannot revoke Alice's phone, or learn that its id exists."""
        paired = _pair(client, alice[0]).get_json()

        response = client.post(f"/devices/{paired['device_id']}/revoke", headers=bob[1])

        assert response.status_code == 404
        assert client.get(
            "/devices/me", headers=_device_auth(paired["token"])
        ).status_code == 200
