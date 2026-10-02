"""
Schema tests for the Panopto tables (migrations 008-011)
========================================================

`places`, `devices`, `presence_events` and `presence_sessions` have no endpoints
yet, so these exercise the schema directly against the real database: what is
deleted with what, what is refused, and the uniqueness that later phases rely
on instead of checking for themselves.

The cascade tests matter most. `test_security.py` documents how a cascade from
`users` reaching two tables joined by a RESTRICT made accounts undeletable, and
these tables were laid out to avoid that. The tests pin that layout.

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_presence_schema.py -v
"""
import os
import sys
import uuid
from datetime import datetime

import pytest

pytestmark = pytest.mark.integration

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

import mysql.connector  # noqa: E402

from app import get_cursor  # noqa: E402

ER_DUP_ENTRY = 1062
ER_ROW_IS_REFERENCED = 1451
ER_CHECK_CONSTRAINT_VIOLATED = 3819

AT = datetime(2026, 10, 2, 8, 30)


@pytest.fixture(autouse=True)
def _integration_only():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")


def _create_user():
    """A user with one time category, inserted directly. Returns (user_id, category_id)."""
    with get_cursor() as cursor:
        cursor.execute(
            "INSERT INTO users (username, pwd_hash) VALUES (%s, %s)",
            (f"presence_{uuid.uuid4().hex[:12]}", b"not-a-real-hash"),
        )
        user_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO category (user_id, name) VALUES (%s, 'Work')", (user_id,)
        )
        return user_id, cursor.lastrowid


def _delete_user(user_id):
    """Remove a user and the category rows that deliberately outlive them."""
    with get_cursor() as cursor:
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
        cursor.execute("DELETE FROM category WHERE user_id = %s", (user_id,))


@pytest.fixture
def owner():
    user_id, category_id = _create_user()
    yield {"user_id": user_id, "category_id": category_id}
    _delete_user(user_id)


@pytest.fixture
def other_owner():
    user_id, category_id = _create_user()
    yield {"user_id": user_id, "category_id": category_id}
    _delete_user(user_id)


def _place(cursor, owner, name="Office", **overrides):
    values = {"latitude": -23.55, "longitude": -46.63, "radius_m": 150, **overrides}
    cursor.execute(
        """
        INSERT INTO places (user_id, category_id, name, latitude, longitude, radius_m)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (owner["user_id"], owner["category_id"], name,
         values["latitude"], values["longitude"], values["radius_m"]),
    )
    return cursor.lastrowid


def _device(cursor, owner):
    cursor.execute(
        "INSERT INTO devices (user_id, name, token_hash) VALUES (%s, 'Pixel', %s)",
        (owner["user_id"], os.urandom(32)),
    )
    return cursor.lastrowid


def _event(cursor, owner, place_id, device_id=None, client_event_id=None):
    cursor.execute(
        """
        INSERT INTO presence_events
          (user_id, place_id, device_id, client_event_id, kind, occurred_at)
        VALUES (%s, %s, %s, %s, 'enter', %s)
        """,
        (owner["user_id"], place_id, device_id,
         client_event_id or str(uuid.uuid4()), AT),
    )
    return cursor.lastrowid


def _session(cursor, owner, place_id, device_id=None):
    cursor.execute(
        """
        INSERT INTO presence_sessions (user_id, place_id, device_id, started_at)
        VALUES (%s, %s, %s, %s)
        """,
        (owner["user_id"], place_id, device_id, AT),
    )
    return cursor.lastrowid


def _count(cursor, table, column, value):
    cursor.execute(f"SELECT COUNT(*) AS n FROM {table} WHERE {column} = %s", (value,))
    return cursor.fetchone()["n"]


# ─── Shape ────────────────────────────────────────────────────────────────────


class TestShape:
    EXPECTED_COLUMNS = {
        "places": {"id", "user_id", "category_id", "name", "latitude", "longitude",
                   "radius_m", "enabled", "created_at", "updated_at"},
        "devices": {"id", "user_id", "name", "token_hash", "created_at",
                    "last_seen_at", "revoked_at"},
        "presence_events": {"id", "user_id", "place_id", "device_id",
                            "client_event_id", "kind", "occurred_at", "received_at"},
        "presence_sessions": {"id", "user_id", "place_id", "device_id", "started_at"},
    }

    @pytest.mark.parametrize("table", sorted(EXPECTED_COLUMNS))
    def test_table_has_expected_columns(self, table):
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT column_name AS c FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = %s",
                (table,),
            )
            columns = {row["c"] for row in cursor.fetchall()}
        assert columns == self.EXPECTED_COLUMNS[table]

    def test_migrations_are_recorded(self):
        with get_cursor() as cursor:
            cursor.execute("SELECT version FROM schema_migrations")
            versions = {row["version"] for row in cursor.fetchall()}
        assert {
            "008_create_places.sql",
            "009_create_devices.sql",
            "010_create_presence_events.sql",
            "011_create_presence_sessions.sql",
        } <= versions


# ─── What goes with what ──────────────────────────────────────────────────────


class TestDeletion:
    def test_deleting_a_user_removes_all_their_presence_data(self):
        """The account-deletion trap, checked against the new tables.

        This user owns one row in every table the new FKs touch, plus a time
        entry and a category, which is the shape that made accounts undeletable
        before migrations 004-007. The delete must succeed and leave nothing of
        theirs behind except the category, which outlives its owner by design.
        """
        user_id, category_id = _create_user()
        owner = {"user_id": user_id, "category_id": category_id}
        with get_cursor() as cursor:
            place_id = _place(cursor, owner)
            device_id = _device(cursor, owner)
            _event(cursor, owner, place_id, device_id)
            _session(cursor, owner, place_id, device_id)
            cursor.execute(
                "INSERT INTO time_entries (user_id, category_id, start_time, end_time) "
                "VALUES (%s, %s, '2026-10-01 08:00:00', '2026-10-01 17:00:00')",
                (user_id, category_id),
            )

        with get_cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))

        with get_cursor() as cursor:
            for table in ("places", "devices", "presence_events",
                          "presence_sessions", "time_entries"):
                assert _count(cursor, table, "user_id", user_id) == 0, table
            cursor.execute("DELETE FROM category WHERE user_id = %s", (user_id,))

    def test_deleting_a_place_removes_its_events_and_open_stay(self, owner):
        """Deleting a place erases what was recorded there, but not the time
        entries already written: those are the user's history, in a category."""
        with get_cursor() as cursor:
            place_id = _place(cursor, owner)
            _event(cursor, owner, place_id)
            _session(cursor, owner, place_id)
            cursor.execute(
                "INSERT INTO time_entries (user_id, category_id, start_time, end_time) "
                "VALUES (%s, %s, '2026-10-01 08:00:00', '2026-10-01 17:00:00')",
                (owner["user_id"], owner["category_id"]),
            )

        with get_cursor() as cursor:
            cursor.execute("DELETE FROM places WHERE id = %s", (place_id,))

        with get_cursor() as cursor:
            assert _count(cursor, "presence_events", "place_id", place_id) == 0
            assert _count(cursor, "presence_sessions", "place_id", place_id) == 0
            assert _count(cursor, "time_entries", "user_id", owner["user_id"]) == 1

    def test_deleting_a_device_keeps_its_events(self, owner):
        """Devices are normally revoked, not deleted. If one is deleted, the
        events it sent stay, with no device attached."""
        with get_cursor() as cursor:
            place_id = _place(cursor, owner)
            device_id = _device(cursor, owner)
            event_id = _event(cursor, owner, place_id, device_id)

        with get_cursor() as cursor:
            cursor.execute("DELETE FROM devices WHERE id = %s", (device_id,))

        with get_cursor() as cursor:
            cursor.execute(
                "SELECT device_id FROM presence_events WHERE id = %s", (event_id,)
            )
            assert cursor.fetchone() == {"device_id": None}

    def test_a_category_used_by_a_place_cannot_be_deleted(self, owner):
        """Pinned so phase 3 has to deal with it: category_admin counts only
        entries as usage today, so this would surface as a 500 there."""
        with get_cursor() as cursor:
            _place(cursor, owner)

        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                cursor.execute(
                    "DELETE FROM category WHERE id = %s", (owner["category_id"],)
                )
        assert error.value.errno == ER_ROW_IS_REFERENCED


# ─── Uniqueness later phases rely on ──────────────────────────────────────────


class TestUniqueness:
    def test_a_user_has_at_most_one_open_stay(self, owner):
        with get_cursor() as cursor:
            first = _place(cursor, owner, name="Office")
            second = _place(cursor, owner, name="Gym")
            _session(cursor, owner, first)

        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                _session(cursor, owner, second)
        assert error.value.errno == ER_DUP_ENTRY

    def test_a_resent_event_is_refused(self, owner):
        """The offline queue resends batches it could not confirm. The unique
        key is what keeps the second copy out."""
        event_id = str(uuid.uuid4())
        with get_cursor() as cursor:
            place_id = _place(cursor, owner)
            _event(cursor, owner, place_id, client_event_id=event_id)

        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                _event(cursor, owner, place_id, client_event_id=event_id)
        assert error.value.errno == ER_DUP_ENTRY

    def test_event_ids_are_scoped_per_user(self, owner, other_owner):
        event_id = str(uuid.uuid4())
        with get_cursor() as cursor:
            _event(cursor, owner, _place(cursor, owner), client_event_id=event_id)
            _event(cursor, other_owner, _place(cursor, other_owner),
                   client_event_id=event_id)
            assert _count(cursor, "presence_events", "client_event_id", event_id) == 2

    def test_place_names_are_unique_per_user(self, owner, other_owner):
        with get_cursor() as cursor:
            _place(cursor, owner, name="Office")
            _place(cursor, other_owner, name="Office")

        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                _place(cursor, owner, name="Office")
        assert error.value.errno == ER_DUP_ENTRY

    def test_device_token_hashes_are_unique(self, owner, other_owner):
        token_hash = os.urandom(32)
        with get_cursor() as cursor:
            cursor.execute(
                "INSERT INTO devices (user_id, name, token_hash) VALUES (%s, 'A', %s)",
                (owner["user_id"], token_hash),
            )

        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                cursor.execute(
                    "INSERT INTO devices (user_id, name, token_hash) VALUES (%s, 'B', %s)",
                    (other_owner["user_id"], token_hash),
                )
        assert error.value.errno == ER_DUP_ENTRY


# ─── Range checks ─────────────────────────────────────────────────────────────


class TestPlaceChecks:
    def test_boundary_values_are_accepted(self, owner):
        with get_cursor() as cursor:
            _place(cursor, owner, name="South-west", latitude=-90, longitude=-180,
                   radius_m=100)
            _place(cursor, owner, name="North-east", latitude=90, longitude=180,
                   radius_m=2000)
            assert _count(cursor, "places", "user_id", owner["user_id"]) == 2

    @pytest.mark.parametrize("override", [
        {"latitude": 90.000001},
        {"latitude": -90.000001},
        {"longitude": 180.000001},
        {"longitude": -180.000001},
        {"radius_m": 99},
        {"radius_m": 2001},
    ], ids=lambda o: "-".join(f"{k}={v}" for k, v in o.items()))
    def test_out_of_range_values_are_refused(self, owner, override):
        with pytest.raises(mysql.connector.Error) as error:
            with get_cursor() as cursor:
                _place(cursor, owner, **override)
        assert error.value.errno == ER_CHECK_CONSTRAINT_VIOLATED
