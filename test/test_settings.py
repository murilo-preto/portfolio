"""
Account & settings tests

Covers the /user/password and /user/preferences endpoints added with the
settings page: password change (authenticated, current password required),
and the server-backed preferences that replaced localStorage-only settings.

Every test here needs a database — importing app.py runs the migration runner,
which connects — so the module skips wholesale unless integration tests are on.
"""
import pytest
import sys
import os
import json
from datetime import datetime

# Mark all tests in this module as integration
pytestmark = pytest.mark.integration

# app.py applies migrations at import time, so it cannot even be imported
# without a live database; skip before the import rather than failing collection.
if os.getenv("RUN_INTEGRATION_TESTS") != "true":
    pytest.skip(
        "Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true",
        allow_module_level=True,
    )

# Add flask-server to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

from app import app, get_cursor  # noqa: E402


DEFAULT_POMODORO = {
    "workMinutes": 25,
    "shortBreakMinutes": 5,
    "longBreakMinutes": 15,
    "sessionsBeforeLongBreak": 4,
}


@pytest.fixture(scope="module")
def test_app():
    """Create test app with the integration test configuration."""
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-integration"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context():
        yield app


@pytest.fixture(scope="module")
def client(test_app):
    """Create a test client for integration tests."""
    with test_app.test_client() as client:
        yield client


@pytest.fixture
def make_user(client):
    """Register a throwaway user and return its credentials plus a token.

    Function-scoped: the password tests change the password out from under the
    account, so no two tests may share one.
    """
    def _make(password="testpass123"):
        username = f"settings_{datetime.now().timestamp()}"
        register = client.post(
            "/register", json={"username": username, "password": password}
        )
        assert register.status_code == 201, register.get_json()

        login = client.post(
            "/login", json={"username": username, "password": password}
        )
        assert login.status_code == 200, login.get_json()

        return {
            "username": username,
            "password": password,
            "token": login.get_json()["access_token"],
        }

    return _make


def auth(user):
    return {"Authorization": f"Bearer {user['token']}"}


class TestChangePasswordAuth:
    """Nobody changes a password without proving who they are."""

    @pytest.mark.integration
    def test_requires_a_token(self, client):
        response = client.post(
            "/user/password",
            json={"current_password": "a", "new_password": "bbbbbb"},
        )
        assert response.status_code == 401

    @pytest.mark.integration
    def test_rejects_a_forged_token(self, client):
        response = client.post(
            "/user/password",
            json={"current_password": "a", "new_password": "bbbbbb"},
            headers={"Authorization": "Bearer not.a.jwt"},
        )
        # app.py installs custom JWT loaders, so a bad token is a 401 rather
        # than flask-jwt-extended's default 422.
        assert response.status_code == 401


class TestChangePasswordValidation:
    """Bad input is refused before anything is written."""

    @pytest.mark.integration
    def test_missing_body_returns_400(self, client, make_user):
        user = make_user()
        response = client.post("/user/password", json={}, headers=auth(user))
        assert response.status_code == 400
        assert "error" in response.get_json()

    @pytest.mark.integration
    def test_missing_new_password_returns_400(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={"current_password": user["password"]},
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_short_new_password_returns_400(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={"current_password": user["password"], "new_password": "abc"},
            headers=auth(user),
        )
        assert response.status_code == 400
        assert "6" in response.get_json()["error"]

    @pytest.mark.integration
    def test_reusing_the_current_password_returns_400(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": user["password"],
            },
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_over_long_new_password_returns_400_not_500(self, client, make_user):
        """bcrypt refuses more than 72 bytes; that must read as a 400."""
        user = make_user()
        response = client.post(
            "/user/password",
            json={"current_password": user["password"], "new_password": "x" * 80},
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_wrong_current_password_returns_401(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={
                "current_password": "definitely-not-it",
                "new_password": "brandnewpass",
            },
            headers=auth(user),
        )
        assert response.status_code == 401

    @pytest.mark.integration
    def test_a_rejected_change_leaves_the_old_password_working(
        self, client, make_user
    ):
        user = make_user()
        client.post(
            "/user/password",
            json={
                "current_password": "definitely-not-it",
                "new_password": "brandnewpass",
            },
            headers=auth(user),
        )

        login = client.post(
            "/login",
            json={"username": user["username"], "password": user["password"]},
        )
        assert login.status_code == 200


class TestChangePasswordSuccess:
    @pytest.mark.integration
    def test_changes_the_password(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": "a-much-better-password",
            },
            headers=auth(user),
        )
        assert response.status_code == 200
        assert "message" in response.get_json()

    @pytest.mark.integration
    def test_the_old_password_stops_working(self, client, make_user):
        user = make_user()
        client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": "a-much-better-password",
            },
            headers=auth(user),
        )

        login = client.post(
            "/login",
            json={"username": user["username"], "password": user["password"]},
        )
        assert login.status_code == 401

    @pytest.mark.integration
    def test_the_new_password_works(self, client, make_user):
        user = make_user()
        client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": "a-much-better-password",
            },
            headers=auth(user),
        )

        login = client.post(
            "/login",
            json={
                "username": user["username"],
                "password": "a-much-better-password",
            },
        )
        assert login.status_code == 200

    @pytest.mark.integration
    def test_no_response_ever_echoes_a_password_or_hash(self, client, make_user):
        user = make_user()
        response = client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": "a-much-better-password",
            },
            headers=auth(user),
        )
        body = response.get_data(as_text=True)
        assert user["password"] not in body
        assert "a-much-better-password" not in body
        assert "pwd_hash" not in body
        assert "$2b$" not in body

    @pytest.mark.integration
    def test_the_stored_hash_actually_changed(self, client, make_user):
        user = make_user()

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT pwd_hash FROM users WHERE username = %s", (user["username"],)
            )
            before = bytes(cursor.fetchone()["pwd_hash"])

        client.post(
            "/user/password",
            json={
                "current_password": user["password"],
                "new_password": "a-much-better-password",
            },
            headers=auth(user),
        )

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT pwd_hash FROM users WHERE username = %s", (user["username"],)
            )
            after = bytes(cursor.fetchone()["pwd_hash"])

        assert before != after
        assert after.startswith(b"$2")


class TestPreferencesTable:
    """The 002 migration must have produced a usable table."""

    @pytest.mark.integration
    def test_user_preferences_table_exists(self, test_app):
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS found FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name = 'user_preferences'"
            )
            assert cursor.fetchone()["found"] == 1

    @pytest.mark.integration
    def test_migration_is_recorded(self, test_app):
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS found FROM schema_migrations WHERE version = %s",
                ("002_add_user_preferences.sql",),
            )
            assert cursor.fetchone()["found"] == 1

    @pytest.mark.integration
    def test_deleting_a_user_cascades_to_their_preferences(self, client, make_user):
        user = make_user()
        client.put("/user/preferences", json={"theme": "dark"}, headers=auth(user))

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (user["username"],)
            )
            user_id = cursor.fetchone()["id"]
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            cursor.execute(
                "SELECT COUNT(*) AS left_over FROM user_preferences WHERE user_id = %s",
                (user_id,),
            )
            assert cursor.fetchone()["left_over"] == 0


class TestReadPreferences:
    @pytest.mark.integration
    def test_requires_a_token(self, client):
        assert client.get("/user/preferences").status_code == 401

    @pytest.mark.integration
    def test_a_new_user_gets_defaults_not_a_404(self, client, make_user):
        user = make_user()
        response = client.get("/user/preferences", headers=auth(user))
        assert response.status_code == 200

        data = response.get_json()
        assert data["username"] == user["username"]
        assert data["theme"] == "system"
        assert data["currency"] == "BRL"
        assert data["settings"]["pomodoro"] == DEFAULT_POMODORO
        assert data["settings"]["timerDailyTargets"] == {}
        assert data["settings"]["todoFilters"] == {}

    @pytest.mark.integration
    def test_defaults_fill_in_keys_a_stored_blob_is_missing(self, client, make_user):
        """A row written before a setting existed must still read complete."""
        user = make_user()
        client.put(
            "/user/preferences",
            json={"settings": {"timerDailyTargets": {"Work": 3600}}},
            headers=auth(user),
        )

        data = client.get("/user/preferences", headers=auth(user)).get_json()
        assert data["settings"]["timerDailyTargets"] == {"Work": 3600}
        assert data["settings"]["pomodoro"] == DEFAULT_POMODORO


class TestWritePreferences:
    @pytest.mark.integration
    def test_requires_a_token(self, client):
        assert client.put("/user/preferences", json={"theme": "dark"}).status_code == 401

    @pytest.mark.integration
    def test_saves_and_reads_back_a_theme(self, client, make_user):
        user = make_user()
        response = client.put(
            "/user/preferences", json={"theme": "dark"}, headers=auth(user)
        )
        assert response.status_code == 200
        assert response.get_json()["theme"] == "dark"

        assert (
            client.get("/user/preferences", headers=auth(user)).get_json()["theme"]
            == "dark"
        )

    @pytest.mark.integration
    def test_saves_and_reads_back_a_currency(self, client, make_user):
        user = make_user()
        client.put("/user/preferences", json={"currency": "usd"}, headers=auth(user))

        data = client.get("/user/preferences", headers=auth(user)).get_json()
        assert data["currency"] == "USD", "a currency code is stored upper-cased"

    @pytest.mark.integration
    def test_a_second_write_updates_rather_than_duplicating_the_row(
        self, client, make_user
    ):
        user = make_user()
        client.put("/user/preferences", json={"theme": "dark"}, headers=auth(user))
        client.put("/user/preferences", json={"theme": "light"}, headers=auth(user))

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS rows_stored FROM user_preferences p "
                "JOIN users u ON p.user_id = u.id WHERE u.username = %s",
                (user["username"],),
            )
            assert cursor.fetchone()["rows_stored"] == 1

        assert (
            client.get("/user/preferences", headers=auth(user)).get_json()["theme"]
            == "light"
        )

    @pytest.mark.integration
    def test_an_omitted_field_is_left_alone(self, client, make_user):
        user = make_user()
        client.put(
            "/user/preferences",
            json={"theme": "dark", "currency": "EUR"},
            headers=auth(user),
        )
        client.put("/user/preferences", json={"theme": "light"}, headers=auth(user))

        data = client.get("/user/preferences", headers=auth(user)).get_json()
        assert data["theme"] == "light"
        assert data["currency"] == "EUR"

    @pytest.mark.integration
    def test_settings_are_merged_one_level_deep(self, client, make_user):
        """Saving one pomodoro field must not wipe the other three."""
        user = make_user()
        client.put(
            "/user/preferences",
            json={"settings": {"pomodoro": {"workMinutes": 50}}},
            headers=auth(user),
        )

        pomodoro = client.get("/user/preferences", headers=auth(user)).get_json()[
            "settings"
        ]["pomodoro"]
        assert pomodoro["workMinutes"] == 50
        assert pomodoro["shortBreakMinutes"] == DEFAULT_POMODORO["shortBreakMinutes"]
        assert pomodoro["longBreakMinutes"] == DEFAULT_POMODORO["longBreakMinutes"]

    @pytest.mark.integration
    def test_saving_one_blob_does_not_touch_another(self, client, make_user):
        user = make_user()
        client.put(
            "/user/preferences",
            json={"settings": {"timerDailyTargets": {"Work": 7200}}},
            headers=auth(user),
        )
        client.put(
            "/user/preferences",
            json={"settings": {"todoFilters": {"status": "pending"}}},
            headers=auth(user),
        )

        settings = client.get("/user/preferences", headers=auth(user)).get_json()[
            "settings"
        ]
        assert settings["timerDailyTargets"] == {"Work": 7200}
        assert settings["todoFilters"] == {"status": "pending"}

    @pytest.mark.integration
    def test_an_empty_patch_changes_nothing(self, client, make_user):
        user = make_user()
        client.put("/user/preferences", json={"theme": "dark"}, headers=auth(user))

        response = client.put("/user/preferences", json={}, headers=auth(user))
        assert response.status_code == 200
        assert response.get_json()["theme"] == "dark"


class TestWritePreferencesValidation:
    @pytest.mark.integration
    def test_unknown_theme_returns_400(self, client, make_user):
        user = make_user()
        response = client.put(
            "/user/preferences", json={"theme": "solarized"}, headers=auth(user)
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_malformed_currency_returns_400(self, client, make_user):
        user = make_user()
        for bad in ["R$", "DOLLAR", "12", 5]:
            response = client.put(
                "/user/preferences", json={"currency": bad}, headers=auth(user)
            )
            assert response.status_code == 400, f"accepted currency {bad!r}"

    @pytest.mark.integration
    def test_non_object_settings_returns_400(self, client, make_user):
        user = make_user()
        response = client.put(
            "/user/preferences", json={"settings": ["not", "an", "object"]},
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_non_object_body_returns_400(self, client, make_user):
        user = make_user()
        response = client.put(
            "/user/preferences",
            data=json.dumps(["nope"]),
            content_type="application/json",
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_oversized_settings_returns_400(self, client, make_user):
        user = make_user()
        oversized = {f"category-number-{i}": i for i in range(3000)}
        response = client.put(
            "/user/preferences",
            json={"settings": {"timerDailyTargets": oversized}},
            headers=auth(user),
        )
        assert response.status_code == 400

    @pytest.mark.integration
    def test_a_rejected_write_leaves_the_stored_row_intact(self, client, make_user):
        user = make_user()
        client.put("/user/preferences", json={"theme": "dark"}, headers=auth(user))
        client.put("/user/preferences", json={"theme": "neon"}, headers=auth(user))

        assert (
            client.get("/user/preferences", headers=auth(user)).get_json()["theme"]
            == "dark"
        )


class TestPreferencesIsolation:
    """Preferences are per user; one account must never read another's."""

    @pytest.mark.integration
    def test_two_users_keep_separate_preferences(self, client, make_user):
        alice = make_user()
        bob = make_user()

        client.put("/user/preferences", json={"theme": "dark"}, headers=auth(alice))
        client.put("/user/preferences", json={"theme": "light"}, headers=auth(bob))

        assert (
            client.get("/user/preferences", headers=auth(alice)).get_json()["theme"]
            == "dark"
        )
        assert (
            client.get("/user/preferences", headers=auth(bob)).get_json()["theme"]
            == "light"
        )

    @pytest.mark.integration
    def test_the_response_names_the_token_holder(self, client, make_user):
        alice = make_user()
        bob = make_user()

        assert (
            client.get("/user/preferences", headers=auth(alice)).get_json()["username"]
            == alice["username"]
        )
        assert (
            client.get("/user/preferences", headers=auth(bob)).get_json()["username"]
            == bob["username"]
        )
