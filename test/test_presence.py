"""
Presence tests (presence.py, routes/presence.py)
================================================

The Namu app reports geofence "enter" and "exit" events; the server turns them
into one stay per person and each finished stay into a time entry. These cover
the endpoint's validation and duplicate handling, every branch of the state
machine in presence.py, settling by time alone (re-entry window, minimum stay,
the 16 h cap), pausing and deleting a place mid-stay, the web app's routes
(reading the stay, ending it early, recent events), and per-user isolation.

The endpoint settles with the real clock, so events here are placed relative to
now. Settling at an arbitrary moment is tested by calling presence.settle
directly with an injected `now`.

Run with:
  RUN_INTEGRATION_TESTS=true pytest test/test_presence.py -v
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.integration

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "flask-server"))

import presence  # noqa: E402
from app import app, get_cursor, get_pool  # noqa: E402

PASSWORD = "S3cur3P@ssw0rd!"

MIN = timedelta(minutes=1)
HOUR = timedelta(hours=1)
CAP = presence.MAX_STAY


@pytest.fixture(scope="module")
def client():
    if os.getenv("RUN_INTEGRATION_TESTS") != "true":
        pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret-key-for-presence-integration-64chars-long!!"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    with app.app_context(), app.test_client() as c:
        yield c


class User:
    """A registered user with a paired phone and one place, "Office"."""

    def __init__(self, client):
        self.client = client
        self.username = f"presence_{uuid.uuid4().hex[:12]}"
        assert client.post(
            "/register", json={"username": self.username, "password": PASSWORD}
        ).status_code == 201
        login = client.post(
            "/login", json={"username": self.username, "password": PASSWORD}
        )
        self.web = {"Authorization": f"Bearer {login.get_json()['access_token']}"}
        categories = client.get("/get/categories", headers=self.web).get_json()
        self.categories = [c["id"] for c in categories["categories"]]

        paired = client.post(
            "/devices/pair",
            json={"username": self.username, "password": PASSWORD, "device_name": "Pixel"},
        )
        assert paired.status_code == 201
        self.device_id = paired.get_json()["device_id"]
        self.device = {"Authorization": f"Device {paired.get_json()['token']}"}

        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (self.username,))
            self.id = cursor.fetchone()["id"]

        self.office = self.place("Office")

    def place(self, name, **overrides):
        body = {
            "name": name,
            "category_id": self.categories[0],
            "latitude": -23.5,
            "longitude": -46.6,
            **overrides,
        }
        response = self.client.post("/places", headers=self.web, json=body)
        assert response.status_code == 201
        return response.get_json()["place"]["id"]

    def post(self, *events):
        return self.client.post(
            "/devices/me/events", headers=self.device, json={"events": list(events)}
        )

    def send(self, *events):
        response = self.post(*events)
        assert response.status_code == 200, response.get_json()
        return response.get_json()

    def stay(self):
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM presence_sessions WHERE user_id = %s", (self.id,)
            )
            return cursor.fetchone()

    def entries(self):
        with get_cursor() as cursor:
            cursor.execute(
                """
                SELECT category_id, start_time, end_time, note FROM time_entries
                WHERE user_id = %s ORDER BY start_time
                """,
                (self.id,),
            )
            return cursor.fetchall()

    def open_stay(self, place_id, started_at, ended_at=None):
        """Put a stay row in place directly, below the endpoint."""
        with get_cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO presence_sessions (user_id, place_id, started_at, ended_at)
                VALUES (%s, %s, %s, %s)
                """,
                (self.id, place_id, started_at, ended_at),
            )


@pytest.fixture
def alice(client):
    return User(client)


@pytest.fixture
def bob(client):
    return User(client)


def _iso(at):
    return at.replace(tzinfo=timezone.utc).isoformat()


def ev(place_id, kind, at, client_event_id=None):
    return {
        "client_event_id": client_event_id or str(uuid.uuid4()),
        "place_id": place_id,
        "kind": kind,
        "occurred_at": _iso(at) if isinstance(at, datetime) else at,
    }


def _now():
    return presence.now_utc()


def _settle(user, now):
    with get_cursor() as cursor:
        presence.lock_user(cursor, user.id)
        return presence.settle(cursor, user.id, now)


def _entry(user, start, end, note="Namu: Office", category=None):
    return {
        "category_id": category or user.categories[0],
        "start_time": start,
        "end_time": end,
        "note": note,
    }


CAPPED_NOTE = "Namu: Office (closed automatically, no departure after 16 h)"


# ─── Parsing (no database) ────────────────────────────────────────────────────


class TestParsing:
    @pytest.mark.parametrize("value, expected", [
        ("2026-10-16T08:59:30.123Z", datetime(2026, 10, 16, 8, 59, 30)),
        ("2026-10-16T08:59:30+00:00", datetime(2026, 10, 16, 8, 59, 30)),
        ("2026-10-16T05:59:30.999-03:00", datetime(2026, 10, 16, 8, 59, 30)),
        ("2026-10-17T01:00:00+02:00", datetime(2026, 10, 16, 23, 0, 0)),
    ])
    def test_times_with_an_offset_become_naive_utc_seconds(self, value, expected):
        assert presence.parse_occurred_at(value) == expected

    @pytest.mark.parametrize("value", [
        "2026-10-16T08:59:30", "2026-10-16", "yesterday", "", None, 1760000000, [],
    ])
    def test_anything_without_an_offset_is_refused(self, value):
        assert presence.parse_occurred_at(value) is None

    def test_uuids_are_canonicalised(self):
        value = "6F9619FF-8B86-D011-B42D-00CF4FC964FF"
        assert presence.parse_client_event_id(value) == value.lower()
        assert presence.parse_client_event_id(value.replace("-", "")) == value.lower()

    @pytest.mark.parametrize("value", ["", "not-a-uuid", "1234", None, 42, "a" * 100])
    def test_anything_but_a_uuid_is_refused(self, value):
        assert presence.parse_client_event_id(value) is None


# ─── The endpoint ─────────────────────────────────────────────────────────────


class TestRequests:
    @pytest.mark.parametrize("body", [
        [], "events", {}, {"events": None}, {"events": {}}, {"events": []},
    ], ids=repr)
    def test_a_malformed_body_is_refused(self, client, alice, body):
        response = client.post("/devices/me/events", headers=alice.device, json=body)
        assert response.status_code == 400

    def test_a_body_that_is_not_json_is_refused(self, client, alice):
        response = client.post(
            "/devices/me/events", headers=alice.device, data="x", content_type="text/plain"
        )
        assert response.status_code == 400

    def test_a_batch_is_at_most_100_events(self, alice):
        at = _now() - HOUR
        events = [ev(alice.office, "enter", at) for _ in range(101)]

        assert alice.post(*events).status_code == 400
        assert alice.post(*events[:100]).status_code == 200

    def test_a_revoked_phone_is_refused(self, client, alice):
        client.post("/devices/me/revoke", headers=alice.device)

        assert alice.post(ev(alice.office, "enter", _now())).status_code == 401
        assert client.get("/devices/me/stay", headers=alice.device).status_code == 401

    def test_a_web_login_is_not_a_device_token(self, client, alice):
        body = {"events": [ev(alice.office, "enter", _now())]}
        assert client.post("/devices/me/events", headers=alice.web, json=body).status_code == 401
        assert client.get("/devices/me/stay", headers=alice.web).status_code == 401

    def test_an_accepted_event_is_recorded(self, alice):
        at = _now() - HOUR
        event = ev(alice.office, "enter", at)

        result = alice.send(event)

        assert result["results"] == [
            {"client_event_id": event["client_event_id"], "status": "accepted"}
        ]
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM presence_events WHERE user_id = %s", (alice.id,)
            )
            rows = cursor.fetchall()
        assert len(rows) == 1
        assert rows[0]["client_event_id"] == event["client_event_id"]
        assert rows[0]["place_id"] == alice.office
        assert rows[0]["device_id"] == alice.device_id
        assert rows[0]["kind"] == "enter"
        assert rows[0]["occurred_at"] == at

    def test_the_response_carries_the_stay_and_enabled_places(self, client, alice):
        alice.place("Paused", enabled=False)
        at = _now() - HOUR

        result = alice.send(ev(alice.office, "enter", at))

        assert result["stay"] == {
            "place_id": alice.office,
            "place_name": "Office",
            "started_at": _iso(at),
            "departed_at": None,
        }
        listed = client.get("/devices/me/places", headers=alice.device).get_json()
        assert result["places"] == listed["places"]
        assert [p["name"] for p in result["places"]] == ["Office"]

    def test_sending_records_when_the_phone_was_seen(self, alice):
        before = _now()
        alice.send(ev(alice.office, "enter", before))
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT last_seen_at FROM devices WHERE id = %s", (alice.device_id,)
            )
            seen = cursor.fetchone()["last_seen_at"]
        assert before <= seen <= _now()

    @pytest.mark.parametrize("change, error", [
        ({"client_event_id": "not-a-uuid"}, "client_event_id must be a UUID"),
        ({"client_event_id": 42}, "client_event_id must be a UUID"),
        ({"client_event_id": None}, "client_event_id must be a UUID"),
        ({"place_id": "1"}, "Unknown place"),
        ({"place_id": True}, "Unknown place"),
        ({"place_id": None}, "Unknown place"),
        ({"place_id": 2 ** 31}, "Unknown place"),
        ({"kind": "arrive"}, "kind must be enter or exit"),
        ({"kind": None}, "kind must be enter or exit"),
        ({"occurred_at": "2026-10-16T08:59:30"}, "UTC offset"),
        ({"occurred_at": "soon"}, "UTC offset"),
        ({"occurred_at": 1760000000}, "UTC offset"),
    ], ids=lambda v: repr(v)[:40])
    def test_invalid_events_are_rejected_one_by_one(self, alice, change, error):
        bad = {**ev(alice.office, "enter", _now() - HOUR), **change}
        good = ev(alice.office, "enter", _now() - HOUR)

        results = alice.send(bad, good)["results"]

        assert results[0]["status"] == "rejected"
        assert error in results[0]["error"]
        # Echoed as given, whatever it was, so the phone can match it.
        assert results[0]["client_event_id"] == bad["client_event_id"]
        assert results[1]["status"] == "accepted"

    def test_an_event_that_is_not_an_object_is_rejected(self, alice):
        results = alice.send("enter", ev(alice.office, "enter", _now()))["results"]
        assert results[0] == {
            "client_event_id": None,
            "status": "rejected",
            "error": "Each event must be an object",
        }
        assert results[1]["status"] == "accepted"

    def test_a_future_event_is_rejected(self, alice):
        far = ev(alice.office, "enter", _now() + 6 * MIN)
        near = ev(alice.office, "enter", _now() + 4 * MIN)

        results = alice.send(far, near)["results"]

        assert results[0]["status"] == "rejected"
        assert results[0]["error"] == "occurred_at is in the future"
        assert results[1]["status"] == "accepted"

    def test_rejected_events_are_not_recorded(self, alice):
        alice.send(ev(alice.office, "arrive", _now()))
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS n FROM presence_events WHERE user_id = %s", (alice.id,)
            )
            assert cursor.fetchone()["n"] == 0
        assert alice.stay() is None

    def test_offsets_are_converted_and_fractions_dropped(self, alice):
        local = (_now() - HOUR).replace(tzinfo=timezone.utc).astimezone(
            timezone(timedelta(hours=-3))
        )
        sent = local.strftime("%Y-%m-%dT%H:%M:%S") + ".987-03:00"

        alice.send(ev(alice.office, "enter", sent))

        assert alice.stay()["started_at"] == local.astimezone(timezone.utc).replace(
            tzinfo=None
        )

    def test_results_follow_request_order(self, alice, bob):
        accepted = ev(alice.office, "enter", _now() - HOUR)
        rejected = ev(bob.office, "enter", _now() - HOUR)
        alice.send(accepted)

        results = alice.send(rejected, accepted, ev(alice.office, "exit", _now()))["results"]

        assert [r["status"] for r in results] == ["rejected", "duplicate", "accepted"]


class TestDuplicates:
    def test_a_resent_event_is_a_duplicate_and_not_applied_again(self, alice):
        t0 = _now() - 3 * HOUR
        enter = ev(alice.office, "enter", t0)
        exit_ = ev(alice.office, "exit", t0 + HOUR)
        alice.send(enter, exit_)
        assert len(alice.entries()) == 1

        # Resending the enter would open a new stay if it were applied again.
        results = alice.send(enter)["results"]

        assert results == [{"client_event_id": enter["client_event_id"], "status": "duplicate"}]
        assert alice.stay() is None
        assert len(alice.entries()) == 1

    def test_a_repeat_within_one_batch_is_a_duplicate(self, alice):
        event = ev(alice.office, "enter", _now() - HOUR)
        results = alice.send(event, event)["results"]
        assert [r["status"] for r in results] == ["accepted", "duplicate"]

    def test_ids_are_compared_in_canonical_form(self, alice):
        event_id = str(uuid.uuid4())
        alice.send(ev(alice.office, "enter", _now() - HOUR, event_id.upper()))

        results = alice.send(ev(alice.office, "exit", _now(), event_id))["results"]

        assert results[0]["status"] == "duplicate"
        with get_cursor() as cursor:
            cursor.execute(
                "SELECT client_event_id FROM presence_events WHERE user_id = %s", (alice.id,)
            )
            assert cursor.fetchone()["client_event_id"] == event_id

    def test_another_user_may_use_the_same_id(self, alice, bob):
        event_id = str(uuid.uuid4())
        alice.send(ev(alice.office, "enter", _now(), event_id))
        results = bob.send(ev(bob.office, "enter", _now(), event_id))["results"]
        assert results[0]["status"] == "accepted"


# ─── The state machine ────────────────────────────────────────────────────────


class TestEnter:
    def test_entering_opens_a_stay(self, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0))

        stay = alice.stay()
        assert (stay["place_id"], stay["started_at"], stay["ended_at"]) == (
            alice.office, t0, None
        )
        assert stay["device_id"] == alice.device_id

    def test_entering_the_same_place_again_changes_nothing(self, alice):
        t0 = _now() - 2 * HOUR
        alice.send(ev(alice.office, "enter", t0))
        alice.send(ev(alice.office, "enter", t0 + HOUR))

        assert alice.stay()["started_at"] == t0
        assert alice.entries() == []

    def test_entering_another_place_closes_the_first_there(self, alice):
        gym = alice.place("Gym", category_id=alice.categories[1])
        t0 = _now() - 3 * HOUR

        alice.send(ev(alice.office, "enter", t0), ev(gym, "enter", t0 + HOUR))

        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]
        stay = alice.stay()
        assert (stay["place_id"], stay["started_at"]) == (gym, t0 + HOUR)

    def test_a_stale_enter_elsewhere_changes_nothing(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - 2 * HOUR
        alice.send(ev(alice.office, "enter", t0))

        alice.send(ev(gym, "enter", t0 - HOUR))

        stay = alice.stay()
        assert (stay["place_id"], stay["started_at"]) == (alice.office, t0)
        assert alice.entries() == []

    def test_entering_a_disabled_place_is_recorded_but_opens_nothing(self, alice):
        paused = alice.place("Paused", enabled=False)

        results = alice.send(ev(paused, "enter", _now() - HOUR))["results"]

        assert results[0]["status"] == "accepted"
        assert alice.stay() is None

    def test_entering_a_disabled_place_leaves_an_open_stay_alone(self, alice):
        paused = alice.place("Paused", enabled=False)
        t0 = _now() - 2 * HOUR
        alice.send(ev(alice.office, "enter", t0), ev(paused, "enter", t0 + HOUR))

        assert alice.stay()["place_id"] == alice.office
        assert alice.entries() == []


class TestExit:
    def test_leaving_marks_the_stay_departed(self, client, alice):
        t0 = _now() - HOUR
        exit_at = _now() - 2 * MIN

        result = alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", exit_at))

        assert result["stay"]["departed_at"] == _iso(exit_at)
        assert alice.stay()["ended_at"] == exit_at
        assert alice.entries() == []

    def test_a_departure_older_than_the_window_becomes_an_entry(self, alice):
        t0 = _now() - 3 * HOUR

        result = alice.send(
            ev(alice.office, "enter", t0), ev(alice.office, "exit", t0 + 2 * HOUR)
        )

        assert result["stay"] is None
        assert alice.stay() is None
        assert alice.entries() == [_entry(alice, t0, t0 + 2 * HOUR)]

    def test_a_second_exit_keeps_the_first(self, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", t0 + 55 * MIN))
        alice.send(ev(alice.office, "exit", t0 + 58 * MIN))
        assert alice.stay()["ended_at"] == t0 + 55 * MIN

    def test_leaving_with_no_stay_changes_nothing(self, alice):
        results = alice.send(ev(alice.office, "exit", _now()))["results"]
        assert results[0]["status"] == "accepted"
        assert alice.stay() is None
        assert alice.entries() == []

    def test_leaving_another_place_changes_nothing(self, alice):
        gym = alice.place("Gym")
        alice.send(ev(alice.office, "enter", _now() - HOUR))
        alice.send(ev(gym, "exit", _now()))
        assert alice.stay()["ended_at"] is None

    def test_a_stale_exit_changes_nothing(self, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0))
        alice.send(ev(alice.office, "exit", t0 - MIN))
        assert alice.stay()["ended_at"] is None

    def test_leaving_a_disabled_place_still_applies(self, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0))
        # Disabled below the endpoint, so pausing's own finalize does not run.
        with get_cursor() as cursor:
            cursor.execute("UPDATE places SET enabled = FALSE WHERE id = %s", (alice.office,))

        departed = _now() - MIN
        alice.send(ev(alice.office, "exit", departed))

        assert alice.stay()["ended_at"] == departed


class TestReentry:
    def test_coming_back_within_the_window_is_one_stay(self, alice):
        t0 = _now() - 3 * HOUR
        alice.send(
            ev(alice.office, "enter", t0),
            ev(alice.office, "exit", t0 + HOUR),
            ev(alice.office, "enter", t0 + HOUR + 10 * MIN),
            ev(alice.office, "exit", t0 + 2 * HOUR),
        )
        assert alice.entries() == [_entry(alice, t0, t0 + 2 * HOUR)]

    def test_coming_back_after_the_window_is_two_stays(self, alice):
        t0 = _now() - 3 * HOUR
        back = t0 + HOUR + 10 * MIN + timedelta(seconds=1)
        alice.send(
            ev(alice.office, "enter", t0),
            ev(alice.office, "exit", t0 + HOUR),
            ev(alice.office, "enter", back),
            ev(alice.office, "exit", t0 + 2 * HOUR),
        )
        assert alice.entries() == [
            _entry(alice, t0, t0 + HOUR),
            _entry(alice, back, t0 + 2 * HOUR),
        ]

    def test_an_enter_that_predates_the_exit_leaves_the_departure(self, alice):
        """The exit is the later fact: the phone was inside at the enter's
        time and has left since. Undoing the departure would keep a stay open
        that the phone has already reported over."""
        t0 = _now() - HOUR
        departed = _now() - MIN
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", departed))

        alice.send(ev(alice.office, "enter", _now() - 2 * MIN))

        stay = alice.stay()
        assert (stay["started_at"], stay["ended_at"]) == (t0, departed)

    def test_leaving_then_entering_elsewhere_ends_the_stay_at_the_exit(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - 3 * HOUR
        alice.send(
            ev(alice.office, "enter", t0),
            ev(alice.office, "exit", t0 + HOUR),
            ev(gym, "enter", t0 + HOUR + 5 * MIN),
        )
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]
        assert alice.stay()["place_id"] == gym

    def test_overlapping_places_never_count_a_minute_twice(self, alice):
        """Entered the gym before the office exit was seen: the office stay
        ends where the gym's begins."""
        gym = alice.place("Gym")
        t0 = _now() - 3 * HOUR
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", _now() - 2 * MIN))

        alice.send(ev(gym, "enter", t0 + HOUR))

        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]
        assert alice.stay()["started_at"] == t0 + HOUR

    def test_a_stale_enter_elsewhere_leaves_a_pending_stay_alone(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", _now() - MIN))

        alice.send(ev(gym, "enter", t0 - HOUR))

        assert alice.stay()["place_id"] == alice.office
        assert alice.entries() == []

    def test_returning_after_the_window_within_one_batch_restarts(self, alice):
        t0 = _now() - 3 * HOUR
        alice.send(
            ev(alice.office, "enter", t0),
            ev(alice.office, "exit", t0 + HOUR),
            ev(alice.office, "enter", t0 + HOUR + 30 * MIN),
        )
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]
        assert alice.stay()["started_at"] == t0 + HOUR + 30 * MIN


class TestOrdering:
    def test_a_batch_is_applied_in_time_order(self, alice):
        t0 = _now() - 3 * HOUR
        alice.send(ev(alice.office, "exit", t0 + HOUR), ev(alice.office, "enter", t0))
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]

    def test_events_at_the_same_second_keep_the_order_sent(self, alice, bob):
        t0 = _now() - HOUR
        at = _now() - 2 * MIN
        alice.send(ev(alice.office, "enter", t0))
        bob.send(ev(bob.office, "enter", t0))

        # Exit then enter: back inside, the exit undone by the re-entry.
        alice.send(ev(alice.office, "exit", at), ev(alice.office, "enter", at))
        # Enter (already there, so nothing) then exit: departed.
        bob.send(ev(bob.office, "enter", at), ev(bob.office, "exit", at))

        assert alice.stay()["ended_at"] is None
        assert bob.stay()["ended_at"] == at

    def test_an_enter_reported_after_its_exit_opens_nothing(self, alice):
        """A straggler from the phone's queue. Opening a stay for it would never
        see the exit again and would log 16 capped hours."""
        t0 = _now() - 3 * HOUR
        alice.send(ev(alice.office, "exit", t0 + HOUR))

        alice.send(ev(alice.office, "enter", t0))

        assert alice.stay() is None
        assert alice.entries() == []

    def test_a_later_exit_elsewhere_does_not_hold_back_an_enter(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - 3 * HOUR
        alice.send(ev(gym, "exit", t0 + HOUR))

        alice.send(ev(alice.office, "enter", t0))

        assert alice.stay()["place_id"] == alice.office


class TestMinimumStay:
    def test_a_stay_under_five_minutes_is_discarded(self, alice):
        t0 = _now() - HOUR
        alice.send(
            ev(alice.office, "enter", t0),
            ev(alice.office, "exit", t0 + 5 * MIN - timedelta(seconds=1)),
        )
        assert alice.stay() is None
        assert alice.entries() == []

    def test_a_stay_of_exactly_five_minutes_is_kept(self, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", t0 + 5 * MIN))
        assert alice.entries() == [_entry(alice, t0, t0 + 5 * MIN)]

    def test_passing_through_on_the_way_elsewhere_logs_nothing(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0), ev(gym, "enter", t0 + 2 * MIN))
        assert alice.entries() == []
        assert alice.stay()["place_id"] == gym


# ─── Settling ─────────────────────────────────────────────────────────────────


class TestSettle:
    def test_a_pending_stay_waits_out_the_window(self, alice):
        t0 = _now()
        alice.open_stay(alice.office, t0, t0 + HOUR)

        assert _settle(alice, t0 + HOUR + 10 * MIN) is False
        assert alice.stay() is not None

        assert _settle(alice, t0 + HOUR + 10 * MIN + timedelta(seconds=1)) is True
        assert alice.stay() is None
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]

    def test_an_open_stay_is_capped_at_sixteen_hours(self, alice):
        t0 = _now()
        alice.open_stay(alice.office, t0)

        assert _settle(alice, t0 + CAP - timedelta(seconds=1)) is False
        assert _settle(alice, t0 + CAP) is True

        assert alice.stay() is None
        assert alice.entries() == [_entry(alice, t0, t0 + CAP, note=CAPPED_NOTE)]

    def test_a_pending_stay_longer_than_the_cap_is_capped(self, alice):
        t0 = _now()
        alice.open_stay(alice.office, t0, t0 + CAP + HOUR)

        # Still inside the re-entry window, but already over the cap.
        assert _settle(alice, t0 + CAP + HOUR + MIN) is True

        assert alice.entries() == [_entry(alice, t0, t0 + CAP, note=CAPPED_NOTE)]

    def test_settling_with_no_stay_does_nothing(self, alice):
        assert _settle(alice, _now()) is False
        assert alice.entries() == []

    def test_the_endpoint_caps_a_forgotten_stay(self, alice):
        t0 = _now() - CAP - HOUR

        result = alice.send(ev(alice.office, "enter", t0))

        assert result["stay"] is None
        assert alice.entries() == [_entry(alice, t0, t0 + CAP, note=CAPPED_NOTE)]

    def test_a_late_enter_elsewhere_cannot_log_more_than_the_cap(self, alice):
        gym = alice.place("Gym")
        t0 = _now() - 20 * HOUR
        alice.open_stay(alice.office, t0)

        alice.send(ev(gym, "enter", _now() - HOUR))

        assert alice.entries() == [_entry(alice, t0, t0 + CAP, note=CAPPED_NOTE)]
        assert alice.stay()["place_id"] == gym

    def test_getting_the_stay_settles_it(self, client, alice):
        t0 = _now() - 3 * HOUR
        alice.open_stay(alice.office, t0, t0 + HOUR)

        response = client.get("/devices/me/stay", headers=alice.device)

        assert response.status_code == 200
        assert response.get_json() == {"stay": None}
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]

    def test_getting_the_stay(self, client, alice):
        assert client.get("/devices/me/stay", headers=alice.device).get_json() == {
            "stay": None
        }
        t0 = _now() - HOUR
        departed = _now() - MIN
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", departed))

        assert client.get("/devices/me/stay", headers=alice.device).get_json() == {
            "stay": {
                "place_id": alice.office,
                "place_name": "Office",
                "started_at": _iso(t0),
                "departed_at": _iso(departed),
            }
        }

    def test_the_note_fits_the_column(self, alice):
        long_name = "x" * 100
        place = alice.place(long_name)
        t0 = _now()
        alice.open_stay(place, t0)

        _settle(alice, t0 + CAP)

        note = alice.entries()[0]["note"]
        assert len(note) <= 255
        assert note.startswith("Namu: " + long_name + " (closed automatically")


class TestSweep:
    @staticmethod
    def _connect():
        return get_pool().get_connection()

    def test_the_sweep_settles_every_user(self, alice, bob):
        t0 = _now()
        alice.open_stay(alice.office, t0, t0 + HOUR)
        bob.open_stay(bob.office, t0)

        finalized = presence.sweep(self._connect, now=t0 + CAP)

        assert finalized is not None and finalized >= 2
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]
        assert bob.entries() == [_entry(bob, t0, t0 + CAP, note=CAPPED_NOTE)]

    def test_the_sweep_skips_when_another_worker_holds_the_lock(self, alice):
        holder = self._connect()
        cursor = holder.cursor()
        try:
            cursor.execute("SELECT GET_LOCK(%s, 0)", (presence.LOCK_NAME,))
            assert cursor.fetchone()[0] == 1

            assert presence.sweep(self._connect) is None
        finally:
            cursor.execute("SELECT RELEASE_LOCK(%s)", (presence.LOCK_NAME,))
            cursor.fetchall()
            cursor.close()
            holder.close()


# ─── Places changing under a stay ─────────────────────────────────────────────


class TestPlaceChanges:
    def test_pausing_a_place_ends_its_stay_now(self, client, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0))

        before = _now()
        response = client.patch(
            f"/places/{alice.office}", headers=alice.web, json={"enabled": False}
        )
        after = _now()

        assert response.status_code == 200
        assert alice.stay() is None
        [entry] = alice.entries()
        assert entry["start_time"] == t0
        assert before <= entry["end_time"] <= after
        assert entry["note"] == "Namu: Office"

    def test_pausing_a_place_after_leaving_ends_at_the_departure(self, client, alice):
        t0 = _now() - HOUR
        departed = _now() - MIN
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", departed))

        client.patch(f"/places/{alice.office}", headers=alice.web, json={"enabled": False})

        assert alice.entries() == [_entry(alice, t0, departed)]

    def test_pausing_a_place_after_a_short_stay_logs_nothing(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - MIN))
        client.patch(f"/places/{alice.office}", headers=alice.web, json={"enabled": False})
        assert alice.stay() is None
        assert alice.entries() == []

    def test_pausing_another_place_leaves_the_stay_alone(self, client, alice):
        gym = alice.place("Gym")
        alice.send(ev(alice.office, "enter", _now() - HOUR))

        client.patch(f"/places/{gym}", headers=alice.web, json={"enabled": False})

        assert alice.stay()["place_id"] == alice.office
        assert alice.entries() == []

    def test_other_edits_leave_the_stay_alone(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - HOUR))
        client.patch(
            f"/places/{alice.office}", headers=alice.web, json={"name": "HQ", "enabled": True}
        )
        assert alice.stay() is not None
        assert alice.entries() == []

    def test_deleting_a_place_discards_its_stay(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - HOUR))

        assert client.delete(f"/places/{alice.office}", headers=alice.web).status_code == 200

        assert alice.stay() is None
        assert alice.entries() == []

    def test_the_entry_uses_the_places_current_category_and_name(self, client, alice):
        t0 = _now() - 3 * HOUR
        alice.send(ev(alice.office, "enter", t0))
        client.patch(
            f"/places/{alice.office}",
            headers=alice.web,
            json={"category_id": alice.categories[1], "name": "HQ"},
        )

        alice.send(ev(alice.office, "exit", t0 + HOUR))

        assert alice.entries() == [
            _entry(alice, t0, t0 + HOUR, note="Namu: HQ", category=alice.categories[1])
        ]


# ─── The web app's routes ─────────────────────────────────────────────────────


WEB_ROUTES = [
    ("get", "/presence/stay"),
    ("post", "/presence/stay/end"),
    ("get", "/presence/events"),
]


class TestWebAuth:
    @pytest.mark.parametrize("method,path", WEB_ROUTES)
    def test_a_web_login_is_needed(self, client, alice, method, path):
        assert getattr(client, method)(path).status_code == 401
        # A device token is not a way in to the web routes.
        assert getattr(client, method)(path, headers=alice.device).status_code == 401


class TestWebStay:
    def test_no_stay(self, client, alice):
        response = client.get("/presence/stay", headers=alice.web)
        assert response.status_code == 200
        assert response.get_json() == {"stay": None}

    def test_the_stay_matches_the_phones_view(self, client, alice):
        t0 = _now() - HOUR
        departed = _now() - MIN
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", departed))

        web = client.get("/presence/stay", headers=alice.web).get_json()

        assert web == client.get("/devices/me/stay", headers=alice.device).get_json()
        assert web["stay"]["departed_at"] == _iso(departed)

    def test_reading_the_stay_settles_it(self, client, alice):
        t0 = _now() - 3 * HOUR
        alice.open_stay(alice.office, t0, t0 + HOUR)

        assert client.get("/presence/stay", headers=alice.web).get_json() == {"stay": None}
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]

    def test_the_stay_returned_is_the_callers(self, client, alice, bob):
        bob.send(ev(bob.office, "enter", _now() - HOUR))
        assert client.get("/presence/stay", headers=alice.web).get_json() == {"stay": None}


class TestWebEndStay:
    def test_an_open_stay_ends_now(self, client, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "enter", t0))

        before = _now()
        response = client.post("/presence/stay/end", headers=alice.web)
        after = _now()

        assert response.status_code == 200
        assert response.get_json()["message"] == "Stay ended"
        assert alice.stay() is None
        [entry] = alice.entries()
        assert entry["start_time"] == t0
        assert before <= entry["end_time"] <= after
        assert entry["note"] == "Namu: Office"
        with get_cursor() as cursor:
            cursor.execute("SELECT id FROM time_entries WHERE user_id = %s", (alice.id,))
            assert response.get_json()["entry_id"] == cursor.fetchone()["id"]

    def test_a_departed_stay_ends_at_its_departure(self, client, alice):
        t0 = _now() - HOUR
        departed = _now() - MIN
        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", departed))

        assert client.post("/presence/stay/end", headers=alice.web).status_code == 200

        assert alice.entries() == [_entry(alice, t0, departed)]

    def test_a_short_stay_is_discarded(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - MIN))

        response = client.post("/presence/stay/end", headers=alice.web)

        assert response.status_code == 200
        assert response.get_json() == {"message": "Stay too short to log", "entry_id": None}
        assert alice.stay() is None
        assert alice.entries() == []

    def test_a_stay_past_the_cap_is_capped(self, client, alice):
        t0 = _now() - CAP - HOUR
        alice.open_stay(alice.office, t0)

        client.post("/presence/stay/end", headers=alice.web)

        assert alice.entries() == [_entry(alice, t0, t0 + CAP, note=CAPPED_NOTE)]

    def test_no_stay_is_not_found(self, client, alice):
        response = client.post("/presence/stay/end", headers=alice.web)
        assert response.status_code == 404
        assert response.get_json() == {"error": "No stay in progress"}

    def test_ending_twice_logs_once(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - HOUR))

        assert client.post("/presence/stay/end", headers=alice.web).status_code == 200
        assert client.post("/presence/stay/end", headers=alice.web).status_code == 404
        assert len(alice.entries()) == 1

    def test_the_phones_later_exit_changes_nothing(self, client, alice):
        alice.send(ev(alice.office, "enter", _now() - HOUR))
        client.post("/presence/stay/end", headers=alice.web)
        [entry] = alice.entries()

        results = alice.send(ev(alice.office, "exit", _now()))["results"]

        assert results[0]["status"] == "accepted"
        assert alice.stay() is None
        assert alice.entries() == [entry]

    def test_another_users_stay_is_left_alone(self, client, alice, bob):
        t0 = _now() - HOUR
        bob.send(ev(bob.office, "enter", t0))

        assert client.post("/presence/stay/end", headers=alice.web).status_code == 404

        assert bob.stay()["started_at"] == t0
        assert bob.entries() == []


class TestWebEvents:
    def test_no_events(self, client, alice):
        response = client.get("/presence/events", headers=alice.web)
        assert response.status_code == 200
        assert response.get_json() == {"events": []}

    def test_events_are_listed_newest_first(self, client, alice):
        t0 = _now() - HOUR
        alice.send(ev(alice.office, "exit", t0 + MIN), ev(alice.office, "enter", t0))

        events = client.get("/presence/events", headers=alice.web).get_json()["events"]

        assert [(e["kind"], e["occurred_at"]) for e in events] == [
            ("exit", _iso(t0 + MIN)),
            ("enter", _iso(t0)),
        ]
        assert set(events[0]) == {
            "id", "kind", "place_id", "place_name", "device_id", "device_name",
            "occurred_at", "received_at",
        }
        assert events[0]["place_id"] == alice.office
        assert events[0]["place_name"] == "Office"
        assert events[0]["device_id"] == alice.device_id
        assert events[0]["device_name"] == "Pixel"
        assert events[0]["received_at"].endswith("+00:00")

    def test_rejected_and_duplicate_events_are_not_listed(self, client, alice):
        event = ev(alice.office, "enter", _now())
        alice.send(event, event, ev(10**9, "enter", _now()))

        events = client.get("/presence/events", headers=alice.web).get_json()["events"]

        assert len(events) == 1

    def test_the_limit_defaults_to_twenty(self, client, alice):
        t0 = _now() - HOUR
        alice.send(*[ev(alice.office, "enter", t0 + i * MIN) for i in range(25)])

        events = client.get("/presence/events", headers=alice.web).get_json()["events"]

        assert len(events) == 20
        assert events[0]["occurred_at"] == _iso(t0 + 24 * MIN)

    def test_a_limit_can_be_asked_for(self, client, alice):
        t0 = _now() - HOUR
        alice.send(*[ev(alice.office, "enter", t0 + i * MIN) for i in range(5)])

        response = client.get("/presence/events?limit=3", headers=alice.web)

        assert len(response.get_json()["events"]) == 3

    @pytest.mark.parametrize("limit", ["0", "101", "-1", "abc", "1.5", ""])
    def test_a_bad_limit_is_refused(self, client, alice, limit):
        response = client.get(f"/presence/events?limit={limit}", headers=alice.web)
        assert response.status_code == 400
        assert response.get_json() == {"error": "limit must be a whole number from 1 to 100"}

    def test_a_revoked_phones_events_keep_its_name(self, client, alice):
        alice.send(ev(alice.office, "enter", _now()))
        client.post("/devices/me/revoke", headers=alice.device)

        [event] = client.get("/presence/events", headers=alice.web).get_json()["events"]

        assert event["device_name"] == "Pixel"

    def test_events_outlive_their_phones_row(self, client, alice):
        alice.send(ev(alice.office, "enter", _now()))
        with get_cursor() as cursor:
            cursor.execute("DELETE FROM devices WHERE id = %s", (alice.device_id,))

        [event] = client.get("/presence/events", headers=alice.web).get_json()["events"]

        assert event["device_id"] is None
        assert event["device_name"] is None

    def test_only_the_callers_events_are_listed(self, client, alice, bob):
        bob.send(ev(bob.office, "enter", _now()))
        assert client.get("/presence/events", headers=alice.web).get_json() == {"events": []}


# ─── Isolation ────────────────────────────────────────────────────────────────


class TestIsolation:
    def test_another_users_place_is_unknown(self, alice, bob):
        results = alice.send(ev(bob.office, "enter", _now()))["results"]

        assert results[0]["status"] == "rejected"
        assert results[0]["error"] == "Unknown place"
        assert alice.stay() is None
        assert bob.stay() is None

    def test_one_users_events_never_touch_anothers_stay(self, alice, bob):
        t0 = _now() - 3 * HOUR
        bob.send(ev(bob.office, "enter", t0))

        alice.send(ev(alice.office, "enter", t0), ev(alice.office, "exit", t0 + HOUR))

        assert bob.stay()["started_at"] == t0
        assert bob.entries() == []
        assert alice.entries() == [_entry(alice, t0, t0 + HOUR)]

    def test_the_stay_returned_is_the_callers(self, client, alice, bob):
        bob.send(ev(bob.office, "enter", _now() - HOUR))
        assert client.get("/devices/me/stay", headers=alice.device).get_json() == {
            "stay": None
        }
