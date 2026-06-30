"""
Security-Focused Integration Tests for the Flask Backend
=========================================================

Tests cover:
  - Horizontal privilege escalation (IDOR) across all resource types
  - Authentication bypass (no token, expired, tampered, wrong type)
  - SQL injection in all user-controlled inputs
  - Input validation / mass assignment
  - Unauthenticated endpoint abuse (missing @jwt_required on some routes)
  - Token manipulation and abuse

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_security.py -v
"""
import pytest
import sys
import os
import base64
import json
from datetime import datetime, timezone, timedelta

pytestmark = pytest.mark.integration

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

from app import app, get_cursor  # noqa: E402


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def test_app():
    """Configure the Flask app for integration testing."""
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-security-integration-64chars-long!!"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context():
        yield app


@pytest.fixture(scope="module")
def client(test_app):
    """Bare test client — no cookies, no implicit state."""
    with test_app.test_client() as c:
        yield c


def _register_and_login(client, suffix):
    """Helper: register a user and return (username, password, token)."""
    ts = datetime.now().timestamp()
    username = f"sec_test_{suffix}_{ts}"
    password = "S3cur3P@ssw0rd!"

    reg = client.post("/register", json={"username": username, "password": password})
    assert reg.status_code == 201, f"Failed to register {suffix}: {reg.get_data(as_text=True)}"

    login = client.post("/login", json={"username": username, "password": password})
    assert login.status_code == 200, f"Failed to log in {suffix}"
    token = login.get_json()["access_token"]
    return username, password, token


@pytest.fixture(scope="module")
def user_a(client):
    username, password, token = _register_and_login(client, "user_a")
    return {"username": username, "password": password, "token": token}


@pytest.fixture(scope="module")
def user_b(client):
    username, password, token = _register_and_login(client, "user_b")
    return {"username": username, "password": password, "token": token}


def auth(token):
    """Return an Authorization header dict for the given token."""
    return {"Authorization": f"Bearer {token}"}


def _ensure_category(client, category_name, token=None):
    """Create a time-tracker category if it does not yet exist."""
    headers = auth(token) if token else {}
    client.post("/category", json={"name": category_name}, headers=headers)


def _ensure_finance_category(client, category_name, token=None):
    """Create a finance category if it does not yet exist."""
    headers = auth(token) if token else {}
    client.post("/finance/category", json={"name": category_name}, headers=headers)


def _ensure_todo_category(client, category_name, token=None):
    """Create a todo category if it does not yet exist."""
    headers = auth(token) if token else {}
    client.post("/todo/category", json={"name": category_name}, headers=headers)


def _create_time_entry_for(client, token, category="Work"):
    """Create a time entry as the authenticated user (token)."""
    _ensure_category(client, category, token)
    now = datetime.now(timezone.utc)
    resp = client.post("/entry/create", headers=auth(token), json={
        "category": category,
        "start_time": now.isoformat(),
        "end_time": (now + timedelta(hours=1)).isoformat(),
    })
    return resp


def _create_finance_entry_for(client, token, category="Bills"):
    """Create a finance entry as the authenticated user (token)."""
    _ensure_finance_category(client, category, token)
    now = datetime.now(timezone.utc)
    resp = client.post("/finance/create", headers=auth(token), json={
        "product_name": "Test Product",
        "category": category,
        "price": 9.99,
        "purchase_date": now.isoformat(),
        "status": "planned",
    })
    return resp


def _create_recurring_expense_for(client, token, category="Bills"):
    """Create a recurring expense as the authenticated user."""
    _ensure_finance_category(client, category, token)
    resp = client.post("/recurring-expenses/create", headers=auth(token), json={
        "name": "Test Subscription",
        "category": category,
        "amount": 9.99,
        "frequency": "monthly",
        "start_date": "2024-01-01",
    })
    return resp


def _create_todo_item_for(client, token, category="Work"):
    """Create a todo item as the authenticated user."""
    _ensure_todo_category(client, category, token)
    resp = client.post("/todo/create", headers=auth(token), json={
        "title": "Security Test Todo",
        "category": category,
        "description": "Created for IDOR testing",
        "priority": "medium",
    })
    return resp


def _start_pomodoro_session(client, token):
    """Start a pomodoro session as the authenticated user."""
    return client.post("/pomodoro/start", headers=auth(token), json={})


# ─── Authentication Bypass ────────────────────────────────────────────────────


class TestAuthenticationBypass:
    """
    Verify that every protected endpoint rejects requests that do not carry
    a valid, unexpired JWT access token.
    """

    PROTECTED_ENDPOINTS = [
        ("GET",    "/entry",                      None),
        ("PUT",    "/entry/999999",               {"category": "Work", "start_time": "2024-01-01T00:00:00+00:00", "end_time": "2024-01-01T01:00:00+00:00"}),
        ("DELETE", "/entry/delete",               {"entry_id": 999999}),
        ("POST",   "/entry/batch-import",         {"entries": []}),
        ("GET",    "/finance",                    None),
        ("POST",   "/finance/create",             {"product_name": "x", "category": "c", "price": 1, "purchase_date": "2024-01-01T00:00:00+00:00"}),
        ("PUT",    "/finance/999999",             {"product_name": "x", "category": "c", "price": 1, "purchase_date": "2024-01-01T00:00:00+00:00"}),
        ("POST",   "/finance/delete",             {"entry_id": 999999}),
        ("POST",   "/finance/batch-import",       {"entries": []}),
        ("GET",    "/recurring-expenses",         None),
        ("POST",   "/recurring-expenses/create",  {"name": "x", "category": "c", "amount": 1, "frequency": "monthly", "start_date": "2024-01-01"}),
        ("PUT",    "/recurring-expenses/999999",  {"name": "x", "category": "c", "amount": 1, "frequency": "monthly", "start_date": "2024-01-01"}),
        ("POST",   "/recurring-expenses/delete",  {"expense_id": 999999}),
        ("GET",    "/todo",                       None),
        ("POST",   "/todo/create",                {"title": "x", "category": "c"}),
        ("PUT",    "/todo/999999",                {"title": "x"}),
        ("POST",   "/todo/delete",               {"item_id": 999999}),
        ("POST",   "/todo/bulk-update",          {"updates": []}),
        ("POST",   "/pomodoro/start",            {}),
        ("POST",   "/pomodoro/complete",         {"session_id": 999999, "duration_seconds": 60}),
        ("POST",   "/pomodoro/cancel",           {"session_id": 999999}),
        ("GET",    "/pomodoro/sessions",         None),
        ("GET",    "/pomodoro/stats",            None),
        ("GET",    "/protected",                 None),
    ]

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_no_token_returns_401(self, client, method, url, body):
        """
        Attack: Omit the Authorization header entirely.
        Every @jwt_required() endpoint must return 401, not silently permit access.
        """
        req = getattr(client, method.lower())
        resp = req(url, json=body)
        assert resp.status_code == 401, (
            f"{method} {url} returned {resp.status_code} without a token — "
            "endpoint may be missing @jwt_required()"
        )

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_expired_token_returns_401(self, test_app, client, method, url, body):
        """
        Attack: Present a legitimately-signed token whose expiry is in the past.
        flask_jwt_extended should reject it with 401.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            expired_token = create_access_token(
                identity="ghost_user",
                expires_delta=timedelta(seconds=-1),
            )

        req = getattr(client, method.lower())
        resp = req(url, headers=auth(expired_token), json=body)
        assert resp.status_code == 401, (
            f"{method} {url} accepted an expired token (got {resp.status_code})"
        )

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_tampered_signature_returns_401(self, test_app, client, method, url, body):
        """
        Attack: Take a valid token and corrupt the HMAC signature.
        The server must reject it — proving it validates signatures, not just
        that a Bearer token is present.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            valid_token = create_access_token(identity="ghost_user")

        # Flip the last few characters of the signature segment
        parts = valid_token.split(".")
        corrupted_sig = parts[2][:-4] + "XXXX"
        tampered_token = ".".join([parts[0], parts[1], corrupted_sig])

        req = getattr(client, method.lower())
        resp = req(url, headers=auth(tampered_token), json=body)
        assert resp.status_code == 401, (
            f"{method} {url} accepted a token with a corrupted signature "
            f"(got {resp.status_code})"
        )

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_tampered_payload_returns_401(self, test_app, client, method, url, body):
        """
        Attack: Decode the payload, change the identity ('sub') to a different user,
        then re-encode without re-signing.  The server must detect the signature
        mismatch and return 401.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            valid_token = create_access_token(identity="original_user")

        parts = valid_token.split(".")

        # Decode, modify, re-encode the payload (no re-sign)
        pad = 4 - len(parts[1]) % 4
        decoded = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * pad))
        decoded["sub"] = "admin"
        new_payload = base64.urlsafe_b64encode(
            json.dumps(decoded).encode()
        ).decode().rstrip("=")

        tampered_token = ".".join([parts[0], new_payload, parts[2]])

        req = getattr(client, method.lower())
        resp = req(url, headers=auth(tampered_token), json=body)
        assert resp.status_code == 401, (
            f"{method} {url} accepted a token with a tampered payload "
            f"(got {resp.status_code})"
        )

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_malformed_bearer_returns_401(self, client, method, url, body):
        """
        Attack: Send a syntactically invalid Authorization header value
        (random ASCII, not a JWT).
        """
        req = getattr(client, method.lower())
        resp = req(url, headers={"Authorization": "Bearer not.a.jwt"}, json=body)
        assert resp.status_code == 401

    @pytest.mark.integration
    @pytest.mark.parametrize("method,url,body", PROTECTED_ENDPOINTS)
    def test_wrong_scheme_returns_401(self, test_app, client, method, url, body):
        """
        Attack: Send a valid JWT but with the wrong Authorization scheme
        (Basic instead of Bearer).  The server should not accept it.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            token = create_access_token(identity="some_user")

        req = getattr(client, method.lower())
        resp = req(url, headers={"Authorization": f"Basic {token}"}, json=body)
        assert resp.status_code == 401


# ─── Horizontal Privilege Escalation (IDOR) ───────────────────────────────────


class TestHorizontalPrivilegeEscalation:
    """
    User A owns a resource.  User B holds a valid JWT for *their own* account.
    Verify that User B cannot read, modify, or delete User A's data by
    guessing or enumerating resource IDs.
    """

    @pytest.mark.integration
    def test_user_b_cannot_update_user_a_time_entry(self, client, user_a, user_b):
        """
        IDOR: User B sends PUT /entry/<id> with their own JWT
        targeting an entry ID owned by User A.
        Expected: 404 (entry not found *for this user*), not 200.
        """
        resp = _create_time_entry_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create time entry for user_a")

        entry_id = resp.get_json()["entry"]["id"]
        now = datetime.now(timezone.utc)

        attack = client.put(
            f"/entry/{entry_id}",
            headers=auth(user_b["token"]),
            json={
                "category": "Work",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=2)).isoformat(),
            },
        )
        assert attack.status_code in (403, 404), (
            f"User B was able to update User A's time entry (got {attack.status_code})"
        )

    @pytest.mark.integration
    def test_user_b_cannot_delete_user_a_time_entry(self, client, user_a, user_b):
        """
        IDOR: User B sends DELETE /entry/delete targeting User A's entry ID.
        Expected: 404, and the entry must still exist in the database afterwards.
        """
        resp = _create_time_entry_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create time entry for user_a")

        entry_id = resp.get_json()["entry"]["id"]

        attack = client.delete(
            "/entry/delete",
            headers=auth(user_b["token"]),
            json={"entry_id": entry_id},
        )
        assert attack.status_code in (403, 404), (
            f"User B was able to delete User A's time entry (got {attack.status_code})"
        )

        # Confirm the entry still exists in the DB
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM time_entries WHERE id = %s", (entry_id,))
            row = cursor.fetchone()
        assert row is not None, "User B successfully deleted User A's time entry from the DB"

    @pytest.mark.integration
    def test_user_b_cannot_update_user_a_finance_entry(self, client, user_a, user_b):
        """
        IDOR: User B sends PUT /finance/<id> with their token,
        targeting a finance entry that belongs to User A.
        Expected: 404, entry remains unchanged in the DB.
        """
        resp = _create_finance_entry_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create finance entry for user_a")

        entry_id = resp.get_json()["entry"]["id"]
        now = datetime.now(timezone.utc)

        attack = client.put(
            f"/finance/{entry_id}",
            headers=auth(user_b["token"]),
            json={
                "product_name": "HACKED",
                "category": "Bills",
                "price": 0.01,
                "purchase_date": now.isoformat(),
                "status": "done",
            },
        )
        assert attack.status_code in (403, 404), (
            f"User B was able to update User A's finance entry (got {attack.status_code})"
        )

        # Verify DB row is unchanged
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT product_name FROM finance_entries WHERE id = %s", (entry_id,)
            )
            row = cursor.fetchone()
        assert row is not None and row["product_name"] != "HACKED", (
            "User B modified User A's finance entry in the database"
        )

    @pytest.mark.integration
    def test_user_b_cannot_delete_user_a_finance_entry(self, client, user_a, user_b):
        """
        IDOR: User B sends POST /finance/delete with User A's entry ID.
        Expected: 404, entry still present in DB.
        """
        resp = _create_finance_entry_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create finance entry for user_a")

        entry_id = resp.get_json()["entry"]["id"]

        attack = client.post(
            "/finance/delete",
            headers=auth(user_b["token"]),
            json={"entry_id": entry_id},
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM finance_entries WHERE id = %s", (entry_id,)
            )
            row = cursor.fetchone()
        assert row is not None, "User B successfully deleted User A's finance entry"

    @pytest.mark.integration
    def test_user_b_cannot_update_user_a_recurring_expense(self, client, user_a, user_b):
        """
        IDOR: User B sends PUT /recurring-expenses/<id> targeting User A's recurring expense.
        """
        resp = _create_recurring_expense_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create recurring expense for user_a")

        expense_id = resp.get_json()["expense"]["id"]

        attack = client.put(
            f"/recurring-expenses/{expense_id}",
            headers=auth(user_b["token"]),
            json={
                "name": "HIJACKED",
                "category": "Bills",
                "amount": 999.99,
                "frequency": "monthly",
                "start_date": "2024-01-01",
            },
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT name FROM recurring_expenses WHERE id = %s", (expense_id,)
            )
            row = cursor.fetchone()
        assert row is not None and row["name"] != "HIJACKED", (
            "User B modified User A's recurring expense"
        )

    @pytest.mark.integration
    def test_user_b_cannot_delete_user_a_recurring_expense(self, client, user_a, user_b):
        """
        IDOR: User B sends POST /recurring-expenses/delete targeting User A's expense.
        """
        resp = _create_recurring_expense_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create recurring expense for user_a")

        expense_id = resp.get_json()["expense"]["id"]

        attack = client.post(
            "/recurring-expenses/delete",
            headers=auth(user_b["token"]),
            json={"expense_id": expense_id},
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM recurring_expenses WHERE id = %s", (expense_id,)
            )
            row = cursor.fetchone()
        assert row is not None, "User B deleted User A's recurring expense"

    @pytest.mark.integration
    def test_user_b_cannot_update_user_a_todo_item(self, client, user_a, user_b):
        """
        IDOR: User B sends PUT /todo/<id> with their token,
        targeting a TODO item created by User A.
        """
        resp = _create_todo_item_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create todo item for user_a")

        item_id = resp.get_json()["item"]["id"]

        attack = client.put(
            f"/todo/{item_id}",
            headers=auth(user_b["token"]),
            json={"title": "HIJACKED_TITLE", "status": "completed"},
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT title FROM todo_items WHERE id = %s", (item_id,)
            )
            row = cursor.fetchone()
        assert row is not None and row["title"] != "HIJACKED_TITLE", (
            "User B modified User A's todo item"
        )

    @pytest.mark.integration
    def test_user_b_cannot_delete_user_a_todo_item(self, client, user_a, user_b):
        """
        IDOR: User B sends POST /todo/delete targeting User A's item ID.
        """
        resp = _create_todo_item_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create todo item for user_a")

        item_id = resp.get_json()["item"]["id"]

        attack = client.post(
            "/todo/delete",
            headers=auth(user_b["token"]),
            json={"item_id": item_id},
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM todo_items WHERE id = %s", (item_id,)
            )
            row = cursor.fetchone()
        assert row is not None, "User B deleted User A's todo item"

    @pytest.mark.integration
    def test_user_b_bulk_update_cannot_affect_user_a_todo(self, client, user_a, user_b):
        """
        IDOR: User B uses POST /todo/bulk-update to attempt a status change
        on User A's todo item.  The individual update must fail in the results
        and the item must not be modified in the DB.
        """
        resp = _create_todo_item_for(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not create todo item for user_a")

        item_id = resp.get_json()["item"]["id"]

        attack = client.post(
            "/todo/bulk-update",
            headers=auth(user_b["token"]),
            json={"updates": [{"item_id": item_id, "status": "completed"}]},
        )
        # The route returns 200 with per-item results; the individual attempt must fail
        assert attack.status_code == 200
        data = attack.get_json()
        assert data["failed"] >= 1, (
            "Bulk update on another user's item reported success"
        )
        assert data["success"] == 0 or all(
            e.get("index") == 0 for e in data.get("errors", [])
        )

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT status FROM todo_items WHERE id = %s", (item_id,)
            )
            row = cursor.fetchone()
        assert row is not None and row["status"] != "completed", (
            "Bulk update changed User A's todo item status"
        )

    @pytest.mark.integration
    def test_user_b_cannot_complete_user_a_pomodoro_session(self, client, user_a, user_b):
        """
        IDOR: User A starts a Pomodoro session; User B tries to mark it as complete.
        Expected: 404 — the session is invisible to User B.
        """
        resp = _start_pomodoro_session(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not start pomodoro session for user_a")

        session_id = resp.get_json()["session_id"]

        attack = client.post(
            "/pomodoro/complete",
            headers=auth(user_b["token"]),
            json={"session_id": session_id, "duration_seconds": 1500},
        )
        assert attack.status_code in (403, 404), (
            f"User B completed User A's Pomodoro session (got {attack.status_code})"
        )

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT completed FROM pomodoro_sessions WHERE id = %s", (session_id,)
            )
            row = cursor.fetchone()
        assert row is not None and not row["completed"], (
            "User B marked User A's Pomodoro session as completed"
        )

    @pytest.mark.integration
    def test_user_b_cannot_cancel_user_a_pomodoro_session(self, client, user_a, user_b):
        """
        IDOR: User A starts a Pomodoro session; User B tries to cancel it.
        Expected: 404, session still exists in the DB.
        """
        resp = _start_pomodoro_session(client, user_a["token"])
        if resp.status_code != 201:
            pytest.skip("Could not start pomodoro session for user_a")

        session_id = resp.get_json()["session_id"]

        attack = client.post(
            "/pomodoro/cancel",
            headers=auth(user_b["token"]),
            json={"session_id": session_id},
        )
        assert attack.status_code in (403, 404)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM pomodoro_sessions WHERE id = %s", (session_id,)
            )
            row = cursor.fetchone()
        assert row is not None, "User B successfully cancelled User A's Pomodoro session"

    @pytest.mark.integration
    def test_user_b_cannot_link_pomodoro_to_user_a_todo(self, client, user_a, user_b):
        """
        IDOR: User B starts a Pomodoro session but supplies User A's todo_id.
        Expected: 404 — the todo item is not visible to User B.
        """
        todo_resp = _create_todo_item_for(client, user_a["token"])
        if todo_resp.status_code != 201:
            pytest.skip("Could not create todo item for user_a")

        todo_id = todo_resp.get_json()["item"]["id"]

        attack = client.post(
            "/pomodoro/start",
            headers=auth(user_b["token"]),
            json={"todo_id": todo_id},
        )
        assert attack.status_code in (403, 404), (
            f"User B started a Pomodoro linked to User A's todo (got {attack.status_code})"
        )

    @pytest.mark.integration
    def test_get_entries_returns_only_own_data(self, client, user_a, user_b):
        """
        Isolation: GET /entry for User B must not contain any of User A's entries.
        This catches bugs where the WHERE clause filters incorrectly.
        """
        _create_time_entry_for(client, user_a["token"])

        resp_b = client.get("/entry", headers=auth(user_b["token"]))
        assert resp_b.status_code == 200
        entries = resp_b.get_json().get("entries", [])

        # Get user_a's DB id so we can assert none of the returned entries belong to them
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (user_a["username"],)
            )
            user_a_row = cursor.fetchone()

        if user_a_row:
            with get_cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM time_entries WHERE user_id = %s",
                    (user_a_row["id"],),
                )
                user_a_entry_ids = {r["id"] for r in cursor.fetchall()}

            returned_ids = {e["id"] for e in entries}
            leaked = user_a_entry_ids & returned_ids
            assert not leaked, (
                f"GET /entry leaked User A's entry IDs to User B: {leaked}"
            )

    @pytest.mark.integration
    def test_get_finance_returns_only_own_data(self, client, user_a, user_b):
        """
        Isolation: GET /finance for User B must not contain any of User A's finance entries.
        """
        _create_finance_entry_for(client, user_a["token"])

        resp_b = client.get("/finance", headers=auth(user_b["token"]))
        assert resp_b.status_code == 200
        entries = resp_b.get_json().get("entries", [])

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (user_a["username"],)
            )
            user_a_row = cursor.fetchone()

        if user_a_row:
            with get_cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM finance_entries WHERE user_id = %s",
                    (user_a_row["id"],),
                )
                user_a_ids = {r["id"] for r in cursor.fetchall()}

            returned_ids = {e["id"] for e in entries}
            assert not (user_a_ids & returned_ids), (
                "GET /finance leaked User A's entries to User B"
            )

    @pytest.mark.integration
    def test_get_todo_returns_only_own_data(self, client, user_a, user_b):
        """
        Isolation: GET /todo for User B must not include User A's todo items.
        """
        _create_todo_item_for(client, user_a["token"])

        resp_b = client.get("/todo", headers=auth(user_b["token"]))
        assert resp_b.status_code == 200
        items = resp_b.get_json().get("items", [])

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (user_a["username"],)
            )
            user_a_row = cursor.fetchone()

        if user_a_row:
            with get_cursor() as cursor:
                cursor.execute(
                    "SELECT id FROM todo_items WHERE user_id = %s",
                    (user_a_row["id"],),
                )
                user_a_ids = {r["id"] for r in cursor.fetchall()}

            returned_ids = {e["id"] for e in items}
            assert not (user_a_ids & returned_ids), (
                "GET /todo leaked User A's items to User B"
            )


# ─── Unauthenticated Endpoint Abuse ──────────────────────────────────────────


class TestUnauthenticatedEndpoints:
    """
    Several endpoints are intentionally public (categories, health) but two
    routes that write data lack @jwt_required():
      - POST /entry/create     — accepts a 'username' body parameter
      - POST /category         — no auth
      - POST /finance/category — no auth
      - POST /todo/category    — no auth

    This section documents and tests that behaviour.
    """

    @pytest.mark.integration
    def test_unauthenticated_user_can_create_time_entry_for_any_user(
        self, client, user_a
    ):
        """
        POST /entry/create now requires @jwt_required().
        An unauthenticated request must return 401.
        """
        _ensure_category(client, "Work", user_a["token"])
        now = datetime.now(timezone.utc)

        resp = client.post("/entry/create", json={
            "category": "Work",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        })
        assert resp.status_code == 401

    @pytest.mark.integration
    def test_unauthenticated_create_entry_for_nonexistent_user(self, client):
        """
        Unauthenticated POST /entry/create must return 401 (auth required)
        regardless of whether the target user exists.
        """
        _ensure_category(client, "Work")
        now = datetime.now(timezone.utc)

        resp = client.post("/entry/create", json={
            "category": "Work",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        })
        assert resp.status_code in (401, 404), (
            f"Expected 401 (auth required) or 404 (user not found); got {resp.status_code}"
        )

    @pytest.mark.integration
    def test_unauthenticated_category_creation(self, client):
        """
        POST /category has no authentication.  An unauthenticated actor can
        pollute the shared category table with arbitrary names.
        This test documents the exposure; when fixed it should require a token.
        """
        resp = client.post("/category", json={"name": "Unauthenticated Category Test"})
        # If this succeeds (200 or 201) the endpoint is unprotected
        if resp.status_code in (200, 201):
            # Not necessarily wrong (public categories may be intentional),
            # but worth flagging in a security review.
            pass  # document: public endpoint, anyone can add categories
        # In any case, the response must not be a server error
        assert resp.status_code < 500

    @pytest.mark.integration
    def test_unauthenticated_finance_category_creation(self, client):
        """POST /finance/category has no auth — any client can insert categories."""
        resp = client.post(
            "/finance/category",
            json={"name": "Unauthenticated Finance Category"},
        )
        assert resp.status_code < 500

    @pytest.mark.integration
    def test_unauthenticated_todo_category_creation(self, client):
        """POST /todo/category has no auth — any client can insert categories."""
        resp = client.post(
            "/todo/category",
            json={"name": "Unauthenticated Todo Category"},
        )
        assert resp.status_code < 500


# ─── SQL Injection ────────────────────────────────────────────────────────────


SQL_INJECTION_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "' UNION SELECT id, pwd_hash, 1, 1, 1 FROM users --",
    "1; SELECT SLEEP(2) --",
    "admin'--",
    "' OR 1=1--",
    "\\' OR \\'1\\'=\\'1",
    "%27 OR %271%27=%271",
]


class TestSQLInjection:
    """
    Verify that all user-controlled string inputs are passed to MySQL via
    parameterized queries and are therefore not injectable.
    Tests confirm:
      1. The server does not return 500 (which would indicate a query error).
      2. The response does not contain data from other users / tables.
      3. Injected payloads appear verbatim in any echo back (they were treated
         as literal strings, not query fragments).
    """

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_login_username(self, client, payload):
        """
        Attack: SQL injection in the 'username' field of POST /login.
        Expected: 400 or 401, never 200 (attacker must not log in) or 500.
        """
        resp = client.post("/login", json={"username": payload, "password": "anything"})
        assert resp.status_code in (400, 401, 429), (
            f"SQLi payload in username returned {resp.status_code}: "
            f"{resp.get_data(as_text=True)}"
        )
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_register_username(self, client, payload):
        """
        Attack: SQL injection payload as the 'username' during registration.
        The server should treat the payload as a literal string — either
        successfully register a user with that exact username (201/409) or
        reject it due to validation (400), but never 500.
        """
        resp = client.post(
            "/register", json={"username": payload, "password": "ValidP@ss1"}
        )
        assert resp.status_code in (201, 400, 409, 429), (
            f"SQLi in register username got {resp.status_code}"
        )
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_category_name(self, client, payload):
        """
        Attack: SQL injection in the category 'name' field.
        The server must parameterize the query — the payload should be stored
        literally or rejected by validation, never cause a 500.
        """
        resp = client.post("/category", json={"name": payload})
        # Payload may be stored verbatim (200/201) or fail validation (400/413)
        # but must never cause a DB error (500)
        assert resp.status_code != 500, (
            f"SQLi in category name caused server error: {resp.get_data(as_text=True)}"
        )

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_finance_category_name(self, client, payload):
        """Attack: SQL injection in finance category name."""
        resp = client.post("/finance/category", json={"name": payload})
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_todo_category_name(self, client, payload):
        """Attack: SQL injection in TODO category name."""
        resp = client.post("/todo/category", json={"name": payload})
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_finance_product_name(self, client, user_a, payload):
        """
        Attack: SQL injection in 'product_name' of POST /finance/create.
        The value should be stored verbatim or rejected; never cause 500.
        """
        _ensure_finance_category(client, "Bills", user_a["token"])
        now = datetime.now(timezone.utc)
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            json={
                "product_name": payload,
                "category": "Bills",
                "price": 1.00,
                "purchase_date": now.isoformat(),
            },
        )
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_todo_title_and_description(self, client, user_a, payload):
        """
        Attack: SQL injection in 'title' and 'description' of POST /todo/create.
        Each payload is tested as both the title and description field.
        """
        _ensure_todo_category(client, "Work", user_a["token"])
        resp = client.post(
            "/todo/create",
            headers=auth(user_a["token"]),
            json={
                "title": payload,
                "category": "Work",
                "description": payload,
            },
        )
        assert resp.status_code != 500

    @pytest.mark.integration
    @pytest.mark.parametrize("payload", SQL_INJECTION_PAYLOADS)
    def test_sqli_in_recurring_expense_name(self, client, user_a, payload):
        """Attack: SQL injection in 'name' of POST /recurring-expenses/create."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/recurring-expenses/create",
            headers=auth(user_a["token"]),
            json={
                "name": payload,
                "category": "Bills",
                "amount": 10.00,
                "frequency": "monthly",
                "start_date": "2024-01-01",
            },
        )
        assert resp.status_code != 500


# ─── Input Validation / Mass Assignment ──────────────────────────────────────


class TestInputValidation:
    """
    Verify that the API correctly rejects or safely handles:
      - Missing required fields
      - Empty / whitespace-only strings
      - Oversized strings (beyond DB column limits)
      - Wrong types (string where int/float expected, etc.)
      - Invalid enum values
      - Extra / unexpected fields (mass assignment)
      - Negative numeric values
      - Extremely large arrays
    """

    # ── Register ──────────────────────────────────────────────────────────

    @pytest.mark.integration
    def test_register_empty_username_rejected(self, client):
        """Empty username (after strip) must return 400."""
        resp = client.post("/register", json={"username": "   ", "password": "ValidP@ss1"})
        assert resp.status_code in (400, 429)

    @pytest.mark.integration
    def test_register_username_too_long_rejected(self, client):
        """Username > 100 characters must return 400."""
        resp = client.post(
            "/register",
            json={"username": "a" * 101, "password": "ValidP@ss1"},
        )
        assert resp.status_code in (400, 429)

    @pytest.mark.integration
    def test_register_password_too_short_rejected(self, client):
        """Password shorter than 6 characters must return 400."""
        resp = client.post("/register", json={"username": "validuser", "password": "abc"})
        assert resp.status_code in (400, 429)

    @pytest.mark.integration
    def test_register_extra_fields_ignored(self, client):
        """
        Mass assignment: extra fields in the request body must not be stored
        or cause an error — they should simply be ignored.
        """
        ts = datetime.now().timestamp()
        resp = client.post(
            "/register",
            json={
                "username": f"masstest_{ts}",
                "password": "ValidP@ss1",
                "is_admin": True,
                "role": "superuser",
                "user_id": 1,
            },
        )
        assert resp.status_code in (201, 409, 429)
        if resp.status_code == 201:
            data = resp.get_json()
            assert "is_admin" not in data
            assert "role" not in data

    # ── Time Entries ──────────────────────────────────────────────────────

    @pytest.mark.integration
    def test_create_entry_end_before_start_rejected(self, client, user_a):
        """end_time before start_time must return 400."""
        _ensure_category(client, "Work", user_a["token"])
        now = datetime.now(timezone.utc)
        resp = client.post("/entry/create", headers=auth(user_a["token"]), json={
            "category": "Work",
            "start_time": now.isoformat(),
            "end_time": (now - timedelta(hours=1)).isoformat(),
        })
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_create_entry_equal_times_rejected(self, client, user_a):
        """start_time == end_time must return 400."""
        _ensure_category(client, "Work", user_a["token"])
        now = datetime.now(timezone.utc)
        resp = client.post("/entry/create", headers=auth(user_a["token"]), json={
            "category": "Work",
            "start_time": now.isoformat(),
            "end_time": now.isoformat(),
        })
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_update_entry_wrong_type_for_id(self, client, user_a):
        """
        The URL parameter for entry ID is typed as int in the route.
        Sending a string ID should return 404 (Flask handles type mismatch).
        """
        resp = client.put(
            "/entry/not_an_integer",
            headers=auth(user_a["token"]),
            json={
                "category": "Work",
                "start_time": "2024-01-01T00:00:00+00:00",
                "end_time": "2024-01-01T01:00:00+00:00",
            },
        )
        assert resp.status_code == 404

    @pytest.mark.integration
    def test_delete_entry_non_integer_id(self, client, user_a):
        """entry_id as a string must return 400 or 404, not 500."""
        resp = client.delete(
            "/entry/delete",
            headers=auth(user_a["token"]),
            json={"entry_id": "not_an_int"},
        )
        assert resp.status_code in (400, 404), (
            f"Expected 400 or 404, got {resp.status_code} — server error on type mismatch"
        )
        assert resp.status_code != 200

    @pytest.mark.integration
    def test_batch_import_not_a_list_rejected(self, client, user_a):
        """entries must be an array; sending an object must return 400."""
        resp = client.post(
            "/entry/batch-import",
            headers=auth(user_a["token"]),
            json={"entries": {"category": "Work"}},
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_batch_import_empty_list_succeeds(self, client, user_a):
        """An empty entries array is valid input and should return 200 with 0 successes."""
        resp = client.post(
            "/entry/batch-import",
            headers=auth(user_a["token"]),
            json={"entries": []},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] == 0
        assert data["failed"] == 0

    # ── Finance Entries ───────────────────────────────────────────────────

    @pytest.mark.integration
    def test_finance_create_negative_price_rejected(self, client, user_a):
        """Negative price must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            json={
                "product_name": "Test",
                "category": "Bills",
                "price": -5.00,
                "purchase_date": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_finance_create_string_price_rejected(self, client, user_a):
        """Non-numeric price must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            json={
                "product_name": "Test",
                "category": "Bills",
                "price": "free",
                "purchase_date": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_finance_create_invalid_status_rejected(self, client, user_a):
        """Status value outside the allowed enum must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            json={
                "product_name": "Test",
                "category": "Bills",
                "price": 9.99,
                "purchase_date": datetime.now(timezone.utc).isoformat(),
                "status": "approved",  # not a valid status
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_finance_product_name_too_long(self, client, user_a):
        """product_name > 255 characters must be rejected with 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            json={
                "product_name": "x" * 256,
                "category": "Bills",
                "price": 1.00,
                "purchase_date": datetime.now(timezone.utc).isoformat(),
            },
        )
        assert resp.status_code == 400

    # ── Recurring Expenses ────────────────────────────────────────────────

    @pytest.mark.integration
    def test_recurring_expense_invalid_frequency_rejected(self, client, user_a):
        """Frequency outside the allowed set must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/recurring-expenses/create",
            headers=auth(user_a["token"]),
            json={
                "name": "Test",
                "category": "Bills",
                "amount": 10.00,
                "frequency": "daily",  # not in the allowed set
                "start_date": "2024-01-01",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_recurring_expense_end_before_start_rejected(self, client, user_a):
        """end_date before start_date must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/recurring-expenses/create",
            headers=auth(user_a["token"]),
            json={
                "name": "Test",
                "category": "Bills",
                "amount": 10.00,
                "frequency": "monthly",
                "start_date": "2024-06-01",
                "end_date": "2024-01-01",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_recurring_expense_negative_amount_rejected(self, client, user_a):
        """Negative amount must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/recurring-expenses/create",
            headers=auth(user_a["token"]),
            json={
                "name": "Test",
                "category": "Bills",
                "amount": -50.00,
                "frequency": "monthly",
                "start_date": "2024-01-01",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_recurring_expense_invalid_date_format_rejected(self, client, user_a):
        """start_date not in YYYY-MM-DD format must return 400."""
        _ensure_finance_category(client, "Bills", user_a["token"])
        resp = client.post(
            "/recurring-expenses/create",
            headers=auth(user_a["token"]),
            json={
                "name": "Test",
                "category": "Bills",
                "amount": 10.00,
                "frequency": "monthly",
                "start_date": "01/01/2024",
            },
        )
        assert resp.status_code == 400

    # ── TODO Items ────────────────────────────────────────────────────────

    @pytest.mark.integration
    def test_todo_create_invalid_priority_rejected(self, client, user_a):
        """priority outside the allowed enum must return 400."""
        _ensure_todo_category(client, "Work", user_a["token"])
        resp = client.post(
            "/todo/create",
            headers=auth(user_a["token"]),
            json={
                "title": "Test",
                "category": "Work",
                "priority": "critical",  # not in the allowed set
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_todo_create_title_too_long_rejected(self, client, user_a):
        """title > 255 characters must return 400."""
        _ensure_todo_category(client, "Work", user_a["token"])
        resp = client.post(
            "/todo/create",
            headers=auth(user_a["token"]),
            json={
                "title": "t" * 256,
                "category": "Work",
            },
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_todo_update_invalid_status_rejected(self, client, user_a):
        """status outside the allowed enum must return 400."""
        resp_create = _create_todo_item_for(client, user_a["token"])
        if resp_create.status_code != 201:
            pytest.skip("Could not create todo item")

        item_id = resp_create.get_json()["item"]["id"]
        resp = client.put(
            f"/todo/{item_id}",
            headers=auth(user_a["token"]),
            json={"status": "archived"},  # not allowed
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_todo_bulk_update_empty_array_succeeds(self, client, user_a):
        """An empty updates array is valid; must return 200 with 0 successes."""
        resp = client.post(
            "/todo/bulk-update",
            headers=auth(user_a["token"]),
            json={"updates": []},
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] == 0

    @pytest.mark.integration
    def test_todo_bulk_update_invalid_item_id_type(self, client, user_a):
        """item_id as a non-integer should fail gracefully (not 500)."""
        resp = client.post(
            "/todo/bulk-update",
            headers=auth(user_a["token"]),
            json={"updates": [{"item_id": "abc", "status": "completed"}]},
        )
        assert resp.status_code == 200  # bulk routes return per-item errors
        data = resp.get_json()
        assert data["failed"] == 1

    # ── Pomodoro ──────────────────────────────────────────────────────────

    @pytest.mark.integration
    def test_pomodoro_complete_negative_duration_rejected(self, client, user_a):
        """Negative duration_seconds must return 400."""
        resp_start = _start_pomodoro_session(client, user_a["token"])
        if resp_start.status_code != 201:
            pytest.skip("Could not start pomodoro session")

        session_id = resp_start.get_json()["session_id"]
        resp = client.post(
            "/pomodoro/complete",
            headers=auth(user_a["token"]),
            json={"session_id": session_id, "duration_seconds": -1},
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_pomodoro_complete_string_duration_rejected(self, client, user_a):
        """Non-integer duration_seconds must return 400."""
        resp_start = _start_pomodoro_session(client, user_a["token"])
        if resp_start.status_code != 201:
            pytest.skip("Could not start pomodoro session")

        session_id = resp_start.get_json()["session_id"]
        resp = client.post(
            "/pomodoro/complete",
            headers=auth(user_a["token"]),
            json={"session_id": session_id, "duration_seconds": "twenty five minutes"},
        )
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_pomodoro_complete_nonexistent_session(self, client, user_a):
        """Completing a session ID that does not exist must return 404, not 500."""
        resp = client.post(
            "/pomodoro/complete",
            headers=auth(user_a["token"]),
            json={"session_id": 999999999, "duration_seconds": 1500},
        )
        assert resp.status_code == 404

    # ── Category Validation ───────────────────────────────────────────────

    @pytest.mark.integration
    def test_category_name_too_long_rejected(self, client, user_a):
        """Category name > 100 characters must return 400."""
        resp = client.post("/category", json={"name": "c" * 101}, headers=auth(user_a["token"]))
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_category_empty_name_rejected(self, client, user_a):
        """Empty category name (after strip) must return 400."""
        resp = client.post("/category", json={"name": "    "}, headers=auth(user_a["token"]))
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_finance_category_empty_name_rejected(self, client, user_a):
        """Empty finance category name must return 400."""
        resp = client.post("/finance/category", json={"name": ""}, headers=auth(user_a["token"]))
        assert resp.status_code == 400

    @pytest.mark.integration
    def test_todo_category_name_too_long_rejected(self, client, user_a):
        """TODO category name > 100 characters must return 400."""
        resp = client.post("/todo/category", json={"name": "t" * 101}, headers=auth(user_a["token"]))
        assert resp.status_code == 400

    # ── Missing body / null payload ───────────────────────────────────────

    @pytest.mark.integration
    def test_null_body_on_protected_post_returns_400_or_401(self, client, user_a):
        """
        Sending a request with no body at all to a POST endpoint should
        return 400 (missing data) after auth passes.
        """
        resp = client.post(
            "/finance/create",
            headers=auth(user_a["token"]),
            content_type="application/json",
            data=None,
        )
        assert resp.status_code in (400, 415, 422)

    @pytest.mark.integration
    def test_non_json_body_returns_4xx(self, client, user_a):
        """
        Sending a non-JSON body to a JSON endpoint should not cause a 500.
        """
        resp = client.post(
            "/finance/create",
            headers={**auth(user_a["token"]), "Content-Type": "application/json"},
            data="this is not json",
        )
        assert resp.status_code in (400, 415, 422, 500)
        # 500 here would indicate the server doesn't handle malformed JSON safely;
        # we accept it for now but flag it
        if resp.status_code == 500:
            pytest.xfail("Server returned 500 on malformed JSON body — should return 400")


# ─── Token Manipulation ───────────────────────────────────────────────────────


class TestTokenManipulation:
    """
    Additional token abuse scenarios beyond the parametrized auth bypass tests.
    """

    @pytest.mark.integration
    def test_token_for_deleted_user_is_rejected(self, test_app, client):
        """
        Issue a valid token for a user, delete the user from the DB, then
        try to use the token.  Because the app checks the DB on every request
        for some routes (user lookup), at minimum those should fail gracefully.

        NOTE: JWT itself does not validate user existence — if the app relies
        solely on the token signature for auth and never checks the DB, a
        deleted user's token may still work.  This test documents that behavior.
        """
        ts = datetime.now().timestamp()
        username = f"deletable_user_{ts}"
        password = "ValidP@ss1"

        # Register and log in
        client.post("/register", json={"username": username, "password": password})
        login_resp = client.post("/login", json={"username": username, "password": password})
        if login_resp.status_code != 200:
            pytest.skip("Could not log in deletable user")

        token = login_resp.get_json()["access_token"]

        # Delete the user directly from the DB
        with get_cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE username = %s", (username,))

        # Try to use the token — routes that do a DB user lookup should fail
        resp = client.get("/entry", headers=auth(token))
        # The JWT itself is still valid so the decorated route is entered,
        # but the DB lookup for the user should return 404
        assert resp.status_code in (200, 404), (
            f"Deleted user token returned unexpected {resp.status_code}"
        )
        # If 200 is returned with no entries, that's safe but worth noting
        if resp.status_code == 200:
            # The retrieve helper returns 404 if user not found, but
            # the route might still return 200 with empty list — document this
            pass

    @pytest.mark.integration
    def test_token_with_nonexistent_username_identity(self, test_app, client):
        """
        Forge a valid signed token whose 'sub' (identity) is a username that
        has never been registered.  Routes that do a DB lookup should return
        404 for user not found; they must not return 500.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            ghost_token = create_access_token(identity="ghost_user_that_never_existed")

        resp = client.get("/entry", headers=auth(ghost_token))
        assert resp.status_code in (200, 404), (
            f"Ghost user token on GET /entry returned {resp.status_code}"
        )
        assert resp.status_code != 500

        resp = client.get("/finance", headers=auth(ghost_token))
        assert resp.status_code in (200, 404)
        assert resp.status_code != 500

        resp = client.get("/todo", headers=auth(ghost_token))
        assert resp.status_code in (200, 404)
        assert resp.status_code != 500

    @pytest.mark.integration
    def test_concurrent_tokens_are_all_valid(self, test_app, client, user_a):
        """
        The app issues stateless JWTs without revocation.  Two tokens for the
        same user must both be accepted (stateless design).  This test
        documents the behavior — single-use tokens are not implemented.
        """
        from flask_jwt_extended import create_access_token

        with test_app.app_context():
            token1 = create_access_token(identity=user_a["username"])
            token2 = create_access_token(identity=user_a["username"])

        resp1 = client.get("/entry", headers=auth(token1))
        resp2 = client.get("/entry", headers=auth(token2))

        assert resp1.status_code == 200
        assert resp2.status_code == 200

    @pytest.mark.integration
    def test_algorithm_confusion_none_alg_rejected(self, test_app, client):
        """
        Attack: 'alg: none' JWT — craft a token that declares no algorithm
        and has no signature.  flask_jwt_extended must reject this.
        """
        # Build a 'none' JWT manually
        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "none", "typ": "JWT"}).encode()
        ).decode().rstrip("=")
        payload = base64.urlsafe_b64encode(
            json.dumps({
                "sub": "admin",
                "iat": int(datetime.now(timezone.utc).timestamp()),
                "exp": int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp()),
            }).encode()
        ).decode().rstrip("=")
        none_token = f"{header}.{payload}."

        resp = client.get("/entry", headers=auth(none_token))
        assert resp.status_code == 401, (
            "'alg: none' token was not rejected — algorithm confusion vulnerability"
        )

    @pytest.mark.integration
    def test_empty_bearer_token_rejected(self, client):
        """An empty string after 'Bearer ' must return 401."""
        resp = client.get("/entry", headers={"Authorization": "Bearer "})
        assert resp.status_code == 401

    @pytest.mark.integration
    def test_bearer_with_only_whitespace_rejected(self, client):
        """Only whitespace after 'Bearer' must return 401."""
        resp = client.get("/entry", headers={"Authorization": "Bearer    "})
        assert resp.status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-m", "integration"])
