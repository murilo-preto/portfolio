"""
Task ↔ time linking tests

Covers the connections between the three time-related features, which until
now did not talk to each other:

  * a finished focus session can materialise as a time entry, so a day spent
    in the Pomodoro screen stops reading as zero hours on the entries
    dashboard;
  * a finished focus session moves the task it was aimed at out of `pending`;
  * every TODO item carries how much focus it has actually absorbed.

Every test here needs a database — importing app.py runs the migration runner,
which connects — so the module skips wholesale unless integration tests are on.
"""
import pytest
import sys
import os
from datetime import datetime, timezone

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


def auth(user):
    return {"Authorization": f"Bearer {user['token']}"}


@pytest.fixture
def make_user(client):
    """Register a throwaway user and return its credentials plus a token."""
    def _make():
        username = f"link_{datetime.now().timestamp()}"
        password = "testpass123"
        register = client.post(
            "/register", json={"username": username, "password": password}
        )
        assert register.status_code == 201, register.get_json()

        login = client.post(
            "/login", json={"username": username, "password": password}
        )
        assert login.status_code == 200, login.get_json()

        return {"username": username, "token": login.get_json()["access_token"]}

    return _make


@pytest.fixture
def time_category(client, make_user):
    """A time category, created by whichever user asks for one.

    Categories are still global rather than per-user (see roadmap item 9), so
    the name is made unique per test rather than per account.
    """
    def _make(user, name=None):
        name = name or f"Focus{datetime.now().timestamp()}".replace(".", "")
        response = client.post("/category", json={"name": name}, headers=auth(user))
        assert response.status_code in (200, 201), response.get_json()
        return name

    return _make


@pytest.fixture
def make_todo(client):
    """Create a TODO item and return its id."""
    def _make(user, title="Write the thing", status=None):
        category = f"Cat{datetime.now().timestamp()}".replace(".", "")
        created_cat = client.post(
            "/todo/category", json={"name": category}, headers=auth(user)
        )
        assert created_cat.status_code in (200, 201), created_cat.get_json()

        response = client.post(
            "/todo/create",
            json={"title": title, "category": category},
            headers=auth(user),
        )
        assert response.status_code == 201, response.get_json()
        item_id = response.get_json()["item"]["id"]

        if status:
            updated = client.put(
                f"/todo/{item_id}", json={"status": status}, headers=auth(user)
            )
            assert updated.status_code == 200, updated.get_json()

        return item_id

    return _make


def start_session(client, user, todo_id=None, session_type="pomodoro"):
    body = {"session_type": session_type}
    if todo_id is not None:
        body["todo_id"] = todo_id
    response = client.post("/pomodoro/start", json=body, headers=auth(user))
    assert response.status_code == 201, response.get_json()
    return response.get_json()["session_id"]


def get_todo(client, user, todo_id):
    listing = client.get("/todo", headers=auth(user))
    assert listing.status_code == 200, listing.get_json()
    for item in listing.get_json()["items"]:
        if item["id"] == todo_id:
            return item
    return None


class TestFocusSessionBecomesTimeEntry:
    """A finished focus session can be written to the time log."""

    def test_no_category_writes_no_entry(self, client, make_user):
        """Logging is opt-in: omitting the category leaves the time log alone."""
        user = make_user()
        before = len(client.get("/entry", headers=auth(user)).get_json()["entries"])

        session_id = start_session(client, user)
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 1500},
            headers=auth(user),
        )
        assert response.status_code == 200
        assert response.get_json()["time_entry_id"] is None

        after = client.get("/entry", headers=auth(user)).get_json()["entries"]
        assert len(after) == before

    def test_category_writes_an_entry_of_the_right_length(
        self, client, make_user, time_category
    ):
        user = make_user()
        category = time_category(user)

        session_id = start_session(client, user)
        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 1500,
                "category": category,
            },
            headers=auth(user),
        )
        assert response.status_code == 200, response.get_json()
        entry_id = response.get_json()["time_entry_id"]
        assert entry_id is not None

        entries = client.get("/entry", headers=auth(user)).get_json()["entries"]
        entry = next(e for e in entries if e["id"] == entry_id)
        assert entry["category"] == category
        assert entry["duration_seconds"] == 1500

    def test_entry_is_noted_with_the_task_it_came_from(
        self, client, make_user, time_category, make_todo
    ):
        """The whole point of the link: the entry says what the time was for."""
        user = make_user()
        category = time_category(user)
        todo_id = make_todo(user, title="Draft the migration runner")

        session_id = start_session(client, user, todo_id=todo_id)
        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 1500,
                "category": category,
            },
            headers=auth(user),
        )
        entry_id = response.get_json()["time_entry_id"]

        entries = client.get("/entry", headers=auth(user)).get_json()["entries"]
        entry = next(e for e in entries if e["id"] == entry_id)
        assert entry["note"] == "Draft the migration runner"

    def test_unknown_category_reports_instead_of_failing(self, client, make_user):
        """The pomodoro is still completed — bookkeeping must not undo it."""
        user = make_user()
        session_id = start_session(client, user)

        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 1500,
                "category": "NoSuchCategoryAnywhere",
            },
            headers=auth(user),
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body["time_entry_id"] is None
        assert "no longer exists" in body["time_entry_error"]

        # The session really did complete despite the failed extra.
        sessions = client.get(
            "/pomodoro/sessions", headers=auth(user)
        ).get_json()["sessions"]
        completed = next(s for s in sessions if s["id"] == session_id)
        assert completed["status"] == "completed"

    def test_zero_length_session_writes_no_entry(
        self, client, make_user, time_category
    ):
        """A time entry needs end > start, so there is nothing to write."""
        user = make_user()
        category = time_category(user)
        session_id = start_session(client, user)

        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 0,
                "category": category,
            },
            headers=auth(user),
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body["time_entry_id"] is None
        assert "too short" in body["time_entry_error"]

    def test_breaks_are_not_logged_as_time_entries(
        self, client, make_user, time_category
    ):
        """A short break is not work, whatever the client asks for."""
        user = make_user()
        category = time_category(user)
        session_id = start_session(client, user, session_type="short_break")

        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 300,
                "category": category,
            },
            headers=auth(user),
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body["time_entry_id"] is None
        assert "focus sessions" in body["time_entry_error"]

    def test_entry_belongs_to_the_session_owner(
        self, client, make_user, time_category
    ):
        """The entry is written for the session's user, not just any user."""
        owner = make_user()
        stranger = make_user()
        category = time_category(owner)

        session_id = start_session(client, owner)
        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 1500,
                "category": category,
            },
            headers=auth(owner),
        )
        entry_id = response.get_json()["time_entry_id"]

        stranger_entries = client.get(
            "/entry", headers=auth(stranger)
        ).get_json()["entries"]
        assert all(e["id"] != entry_id for e in stranger_entries)

    def test_non_string_category_is_rejected(self, client, make_user):
        user = make_user()
        session_id = start_session(client, user)
        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 1500,
                "category": {"name": "Work"},
            },
            headers=auth(user),
        )
        assert response.status_code == 400


class TestFocusSessionAdvancesTheTask:
    """Finishing a pomodoro on a task is proof the task is underway."""

    def test_pending_task_becomes_in_progress(self, client, make_user, make_todo):
        user = make_user()
        todo_id = make_todo(user)
        assert get_todo(client, user, todo_id)["status"] == "pending"

        session_id = start_session(client, user, todo_id=todo_id)
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 1500},
            headers=auth(user),
        )
        assert response.status_code == 200
        assert response.get_json()["todo_status"] == "in_progress"
        assert get_todo(client, user, todo_id)["status"] == "in_progress"

    def test_completed_task_is_not_reopened(self, client, make_user, make_todo):
        """Focusing on something already done must not undo the completion."""
        user = make_user()
        todo_id = make_todo(user, status="completed")

        session_id = start_session(client, user, todo_id=todo_id)
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 1500},
            headers=auth(user),
        )
        assert response.get_json()["todo_status"] == "completed"
        assert get_todo(client, user, todo_id)["status"] == "completed"

    def test_break_does_not_advance_the_task(self, client, make_user, make_todo):
        user = make_user()
        todo_id = make_todo(user)

        session_id = start_session(
            client, user, todo_id=todo_id, session_type="short_break"
        )
        response = client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 300},
            headers=auth(user),
        )
        assert response.get_json()["todo_status"] is None
        assert get_todo(client, user, todo_id)["status"] == "pending"

    def test_task_deleted_mid_session_is_reported_as_gone(
        self, client, make_user, make_todo
    ):
        """A deleted task must not take the session completion down with it.

        The FK on pomodoro_sessions.todo_id is ON DELETE SET NULL, so by the
        time the session completes the link is simply absent — this pins that
        the handler reports it rather than tripping over a dangling id.
        """
        user = make_user()
        todo_id = make_todo(user)
        session_id = start_session(client, user, todo_id=todo_id)

        deleted = client.post(
            "/todo/delete", json={"item_id": todo_id}, headers=auth(user)
        )
        assert deleted.status_code == 200, deleted.get_json()

        response = client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 1500},
            headers=auth(user),
        )
        assert response.status_code == 200
        body = response.get_json()
        assert body["todo_id"] is None
        assert body["todo_status"] is None

    def test_another_users_task_is_never_advanced(
        self, client, make_user, make_todo
    ):
        """/pomodoro/start already refuses the link, so there is nothing to move."""
        owner = make_user()
        stranger = make_user()
        todo_id = make_todo(owner)

        response = client.post(
            "/pomodoro/start",
            json={"todo_id": todo_id},
            headers=auth(stranger),
        )
        assert response.status_code == 404
        assert get_todo(client, owner, todo_id)["status"] == "pending"


class TestFocusAggregatesOnTodoItems:
    """Every task reports the focus it has absorbed."""

    def test_untouched_task_reports_zero(self, client, make_user, make_todo):
        user = make_user()
        todo_id = make_todo(user)

        item = get_todo(client, user, todo_id)
        assert item["focus_sessions"] == 0
        assert item["focus_seconds"] == 0

    def test_completed_sessions_are_counted_and_summed(
        self, client, make_user, make_todo
    ):
        user = make_user()
        todo_id = make_todo(user)

        for duration in (1500, 900):
            session_id = start_session(client, user, todo_id=todo_id)
            client.post(
                "/pomodoro/complete",
                json={"session_id": session_id, "duration_seconds": duration},
                headers=auth(user),
            )

        item = get_todo(client, user, todo_id)
        assert item["focus_sessions"] == 2
        assert item["focus_seconds"] == 2400

    def test_cancelled_sessions_are_not_counted(self, client, make_user, make_todo):
        """Abandoning a pomodoro should not credit the task with the time."""
        user = make_user()
        todo_id = make_todo(user)

        session_id = start_session(client, user, todo_id=todo_id)
        cancelled = client.post(
            "/pomodoro/cancel", json={"session_id": session_id}, headers=auth(user)
        )
        assert cancelled.status_code == 200, cancelled.get_json()

        item = get_todo(client, user, todo_id)
        assert item["focus_sessions"] == 0
        assert item["focus_seconds"] == 0

    def test_breaks_are_not_counted_as_focus(self, client, make_user, make_todo):
        user = make_user()
        todo_id = make_todo(user)

        session_id = start_session(
            client, user, todo_id=todo_id, session_type="long_break"
        )
        client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 900},
            headers=auth(user),
        )

        item = get_todo(client, user, todo_id)
        assert item["focus_sessions"] == 0

    def test_unlinked_sessions_are_not_attributed_to_any_task(
        self, client, make_user, make_todo
    ):
        user = make_user()
        todo_id = make_todo(user)

        session_id = start_session(client, user)
        client.post(
            "/pomodoro/complete",
            json={"session_id": session_id, "duration_seconds": 1500},
            headers=auth(user),
        )

        item = get_todo(client, user, todo_id)
        assert item["focus_sessions"] == 0


class TestFocusPreference:
    """The opt-in lives with the rest of the account preferences."""

    def test_focus_defaults_are_present(self, client, make_user):
        user = make_user()
        settings = client.get(
            "/user/preferences", headers=auth(user)
        ).get_json()["settings"]
        assert settings["focus"] == {"logToTimeEntries": False, "category": None}

    def test_saving_one_focus_field_keeps_the_other(self, client, make_user):
        user = make_user()
        client.put(
            "/user/preferences",
            json={"settings": {"focus": {"logToTimeEntries": True}}},
            headers=auth(user),
        )
        client.put(
            "/user/preferences",
            json={"settings": {"focus": {"category": "Work"}}},
            headers=auth(user),
        )

        focus = client.get(
            "/user/preferences", headers=auth(user)
        ).get_json()["settings"]["focus"]
        assert focus == {"logToTimeEntries": True, "category": "Work"}


class TestLoggedEntryPlacement:
    """The entry has to land where the dashboard will actually find it."""

    def test_entry_ends_at_completion_time(
        self, client, make_user, time_category
    ):
        """The server only knows a duration, so the interval runs backwards
        from now — which is what puts it in *today's* totals."""
        user = make_user()
        category = time_category(user)
        before = datetime.now(timezone.utc)

        session_id = start_session(client, user)
        response = client.post(
            "/pomodoro/complete",
            json={
                "session_id": session_id,
                "duration_seconds": 600,
                "category": category,
            },
            headers=auth(user),
        )
        entry_id = response.get_json()["time_entry_id"]
        after = datetime.now(timezone.utc)

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT start_time, end_time FROM time_entries WHERE id = %s",
                (entry_id,),
            )
            row = cursor.fetchone()

        start = row["start_time"].replace(tzinfo=timezone.utc)
        end = row["end_time"].replace(tzinfo=timezone.utc)
        assert (end - start).total_seconds() == 600
        # Allow a second of slack on either side for the round trip.
        assert before.timestamp() - 1 <= end.timestamp() <= after.timestamp() + 1
