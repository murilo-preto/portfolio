"""Turning a phone's geofence events into stays, and stays into time entries.

The Namu app reports raw "enter" and "exit" transitions with the phone's own
timestamps and queues them while offline. Every decision about what they mean is
made here, on the server, so the rules are the same whichever phone sent them
and can change without an app update.

A user has at most one stay row (`presence_sessions`, UNIQUE (user_id)). It is
either *open* (ended_at NULL: they are there) or *pending* (ended_at set: a
departure was seen and the stay is waiting out the re-entry window). Closing a
stay ("finalizing") writes a normal `time_entries` row in the place's current
category and deletes the stay row, in the caller's transaction.

The rules, which the tests in test_presence.py follow branch by branch:

* An exit followed by an enter at the same place within REENTRY is one
  continuous stay. A geofence boundary jitters, and a phone standing near the
  edge of one reports leaving and arriving again within a minute or two.
* A stay shorter than MIN_STAY is discarded with no entry: driving past a place
  is not time spent there.
* A stay with no departure for MAX_STAY is closed at started_at + MAX_STAY and
  its note says so. A missed exit (phone off, permission revoked) must not log a
  week at the office.
* Entering a second place closes the first at that moment, so overlapping
  places never count the same minutes twice.
* An enter at a disabled place is recorded but opens nothing. Exits always
  apply, so pausing a place mid-stay cannot strand an open stay.

Events are applied in occurred_at order, ties in the order they were sent. A
pending stay is only finalized by `settle`, which runs lazily on the phone's
requests and every five minutes over all users (`start`), so a departure turns
into an entry even if the phone never calls again.

Every DATETIME is naive UTC to the second, like the rest of the schema. Every
function takes a cursor (a dictionary cursor) and joins the caller's
transaction; none commits. This module never imports `app`, so the scheduler
and the tests can drive it with their own connections and their own `now`.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from mysql.connector import Error

import finance_due

logger = logging.getLogger(__name__)


def _seconds_from_env(name, default):
    """A duration in seconds from the environment, overridable for tests."""
    return timedelta(seconds=int(os.getenv(name, str(default))))


REENTRY = _seconds_from_env("PRESENCE_REENTRY_SECONDS", 600)
MIN_STAY = _seconds_from_env("PRESENCE_MIN_STAY_SECONDS", 300)
MAX_STAY = _seconds_from_env("PRESENCE_MAX_STAY_SECONDS", 57600)

# A phone's clock can run a little fast. Anything further ahead than this is a
# bad timestamp, and accepting it would let one event hold a stay open, or
# close one, in the future.
FUTURE_TOLERANCE = timedelta(minutes=5)

MAX_EVENTS_PER_BATCH = 100

# time_entries.note is VARCHAR(255).
MAX_NOTE_LENGTH = 255
NOTE_PREFIX = "Namu: "
CAPPED_SUFFIX = " (closed automatically, no departure after {hours} h)"

# Every gunicorn worker schedules the sweep; the advisory lock means one runs it
# per tick. See finance_due.py, whose pattern this follows.
LOCK_NAME = "namu_presence_sweep"
SWEEP_INTERVAL_MINUTES = 5

_scheduler = None


def now_utc():
    """Naive UTC to the second, the form every DATETIME here is stored in."""
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def iso(value):
    """A stored UTC DATETIME as ISO 8601 with its offset, or None."""
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


# ─── Parsing what the phone sends ─────────────────────────────────────────────


def parse_client_event_id(value):
    """The event's UUID in canonical lowercase form, or None.

    Canonicalised so the same id sent as upper case or without hyphens is still
    recognised as a resend by the UNIQUE key, which compares strings.
    """
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def parse_occurred_at(value):
    """An ISO 8601 time with an offset, as naive UTC to the second, or None.

    A time with no offset is refused rather than guessed at: the phone knows
    its zone and the server does not.
    """
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc).replace(tzinfo=None, microsecond=0)


# ─── The stay row ─────────────────────────────────────────────────────────────


def lock_user(cursor, user_id):
    """Serialize everything that reads and rewrites one user's stay.

    Two batches from the phone, or a batch and the sweep, could otherwise both
    read the same open stay and both write an entry for it. Locking the user row
    rather than the stay row also covers the moment there is no stay row yet.
    """
    cursor.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user_id,))
    return cursor.fetchone() is not None


def load_stay(cursor, user_id):
    """The user's stay row with its place's name and category, or None."""
    cursor.execute(
        """
        SELECT s.id, s.user_id, s.place_id, s.device_id, s.started_at, s.ended_at,
               p.name AS place_name, p.category_id
        FROM presence_sessions s
        JOIN places p ON p.id = s.place_id
        WHERE s.user_id = %s
        """,
        (user_id,),
    )
    return cursor.fetchone()


def stay_json(stay):
    if not stay:
        return None
    return {
        "place_id": stay["place_id"],
        "place_name": stay["place_name"],
        "started_at": iso(stay["started_at"]),
        "departed_at": iso(stay["ended_at"]),
    }


def _open(cursor, user_id, place_id, device_id, started_at):
    cursor.execute(
        """
        INSERT INTO presence_sessions (user_id, place_id, device_id, started_at)
        VALUES (%s, %s, %s, %s)
        """,
        (user_id, place_id, device_id, started_at),
    )


def _set_ended_at(cursor, stay, ended_at):
    cursor.execute(
        "UPDATE presence_sessions SET ended_at = %s WHERE id = %s",
        (ended_at, stay["id"]),
    )


def _note(place_name, capped):
    note = NOTE_PREFIX + place_name
    if capped:
        hours = MAX_STAY.total_seconds() / 3600
        note += CAPPED_SUFFIX.format(hours=f"{hours:g}")
    return note[:MAX_NOTE_LENGTH]


def finalize(cursor, stay, end, capped=False):
    """Close a stay at `end`: write its time entry and delete the row.

    A stay longer than MAX_STAY is cut to it and marked capped whichever path
    closes it, so a late batch cannot log more than the cap either. One shorter
    than MIN_STAY is deleted with no entry. Returns the new entry's id, or None.
    """
    if end - stay["started_at"] > MAX_STAY:
        end = stay["started_at"] + MAX_STAY
        capped = True

    entry_id = None
    if end - stay["started_at"] >= MIN_STAY:
        cursor.execute(
            """
            INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                stay["user_id"],
                stay["category_id"],
                stay["started_at"],
                end,
                _note(stay["place_name"], capped),
            ),
        )
        entry_id = cursor.lastrowid

    cursor.execute("DELETE FROM presence_sessions WHERE id = %s", (stay["id"],))
    return entry_id


# ─── Applying events ──────────────────────────────────────────────────────────


def _left_already(cursor, user_id, place_id, at, before_id):
    """Whether an earlier request already reported leaving this place after `at`.

    Then this enter is a straggler from the phone's queue: the stay it began is
    over, and opening one now would never see its exit again, so it would run
    to the cap and log 16 hours that never happened. Only earlier requests
    count (ids below `before_id`, the user being locked): within one batch, an
    enter followed by its exit is the normal case.
    """
    if before_id is None:
        return False
    cursor.execute(
        """
        SELECT 1 FROM presence_events
        WHERE user_id = %s AND place_id = %s AND kind = 'exit'
          AND occurred_at > %s AND id < %s
        LIMIT 1
        """,
        (user_id, place_id, at, before_id),
    )
    return cursor.fetchone() is not None


def _enter(cursor, user_id, device_id, place, at, before_id=None):
    if not place["enabled"]:
        return
    if _left_already(cursor, user_id, place["id"], at, before_id):
        return

    stay = load_stay(cursor, user_id)
    if stay is None:
        _open(cursor, user_id, place["id"], device_id, at)
        return

    same_place = stay["place_id"] == place["id"]

    if stay["ended_at"] is None:
        if same_place:
            return
        if at < stay["started_at"]:
            # Older than the stay it would close: arrived late from the queue,
            # and the phone has since moved on.
            return
        finalize(cursor, stay, at)
        _open(cursor, user_id, place["id"], device_id, at)
        return

    if same_place:
        if at - stay["ended_at"] <= REENTRY:
            # Back within the window: the departure was boundary jitter. (An
            # enter older than the exit never gets here from the endpoint:
            # within a batch it sorts first, and from a later request
            # _left_already drops it.)
            _set_ended_at(cursor, stay, None)
            return
        finalize(cursor, stay, stay["ended_at"])
        _open(cursor, user_id, place["id"], device_id, at)
        return

    if at < stay["started_at"]:
        return
    # Entered somewhere else after leaving. If the enter came before the exit
    # was reported (overlapping geofences), the first stay ends at the enter so
    # no minute is counted at both.
    finalize(cursor, stay, min(stay["ended_at"], at))
    _open(cursor, user_id, place["id"], device_id, at)


def _exit(cursor, user_id, place, at):
    stay = load_stay(cursor, user_id)
    if (
        stay is not None
        and stay["place_id"] == place["id"]
        and stay["ended_at"] is None
        and at >= stay["started_at"]
    ):
        _set_ended_at(cursor, stay, at)
    # Anything else (no stay, another place's stay, a stale exit, or a second
    # exit while pending, which keeps the first) changes nothing.


def apply_events(cursor, user_id, device_id, events):
    """Apply accepted events to the user's stay, oldest first.

    `events` are dicts with `place` (a places row with id and enabled), `kind`
    and `occurred_at`. The caller has locked the user (lock_user) and inserted
    them into presence_events already, so a resent event never gets here.
    """
    # The batch's first presence_events id, when the caller passes them: what
    # came before it was reported by an earlier request. See _left_already.
    ids = [e["event_id"] for e in events if e.get("event_id") is not None]
    before_id = min(ids) if ids else None

    # sorted() is stable, so events at the same second keep the order sent.
    for event in sorted(events, key=lambda e: e["occurred_at"]):
        if event["kind"] == "enter":
            _enter(
                cursor, user_id, device_id, event["place"], event["occurred_at"],
                before_id,
            )
        else:
            _exit(cursor, user_id, event["place"], event["occurred_at"])


# ─── Settling ─────────────────────────────────────────────────────────────────


def settle(cursor, user_id, now=None):
    """Finalize the user's stay if time alone has decided it.

    A pending stay whose re-entry window has passed closes at its departure; an
    open one that has reached MAX_STAY closes at the cap, as does a pending one
    already longer than the cap. The caller locks the user first. Returns True
    if a stay was finalized.
    """
    now = now or now_utc()
    stay = load_stay(cursor, user_id)
    if stay is None:
        return False

    if stay["ended_at"] is not None:
        if stay["ended_at"] - stay["started_at"] > MAX_STAY:
            finalize(cursor, stay, stay["started_at"] + MAX_STAY, capped=True)
            return True
        if now - stay["ended_at"] > REENTRY:
            finalize(cursor, stay, stay["ended_at"])
            return True
        return False

    if now - stay["started_at"] >= MAX_STAY:
        finalize(cursor, stay, stay["started_at"] + MAX_STAY, capped=True)
        return True
    return False


def end_stay(cursor, user_id, place_id=None, now=None):
    """Finalize the user's stay on request, rather than by an event or by time.

    An open stay ends now; a pending one at the departure already seen. Either
    way MIN_STAY and MAX_STAY apply as usual. With `place_id`, only a stay at
    that place is ended. Locks the user itself.

    Returns None if there was no stay to end, otherwise {"place_name",
    "entry_id"}, where entry_id is None for a stay too short to log.
    """
    lock_user(cursor, user_id)
    stay = load_stay(cursor, user_id)
    if stay is None or (place_id is not None and stay["place_id"] != place_id):
        return None
    end = stay["ended_at"] or now or now_utc()
    return {"place_name": stay["place_name"], "entry_id": finalize(cursor, stay, end)}


def close_stay_at_place(cursor, user_id, place_id, now=None):
    """Finalize the user's stay if it is at this place, as when it is paused."""
    return end_stay(cursor, user_id, place_id, now) is not None


# ─── The background sweep ─────────────────────────────────────────────────────


def sweep(connect, now=None):
    """Settle every user with a stay, each in their own transaction, under the
    advisory lock.

    Returns the number of stays finalized, or None if another worker held the
    lock. One user's failure is logged and rolled back without costing the
    others their sweep.
    """
    connection = connect()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute("SELECT GET_LOCK(%s, 0) AS acquired", (LOCK_NAME,))
        if cursor.fetchone()["acquired"] != 1:
            return None

        try:
            cursor.execute("SELECT user_id FROM presence_sessions")
            user_ids = [row["user_id"] for row in cursor.fetchall()]
            connection.commit()

            finalized = 0
            for user_id in user_ids:
                try:
                    lock_user(cursor, user_id)
                    if settle(cursor, user_id, now):
                        finalized += 1
                    connection.commit()
                except Error as e:
                    connection.rollback()
                    logger.error(f"Presence sweep failed for user {user_id}: {e}")
            return finalized
        finally:
            cursor.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
            cursor.fetchall()
    finally:
        cursor.close()
        connection.close()


def _run_sweep(connect):
    """The scheduled job body. Logs rather than raises, like finance_due's: a
    database blip must not cost the next tick."""
    try:
        finalized = sweep(connect)
        if finalized:
            logger.info(f"Presence sweep finalized {finalized} stay(s)")
    except Exception as e:
        logger.error(f"Presence sweep failed: {e}")


def start(connect):
    """Run the sweep every five minutes in a background thread. Returns the
    scheduler, or None when SCHEDULER_ENABLED=false (the test container)."""
    global _scheduler

    if not finance_due.scheduler_enabled():
        logger.info("Presence sweep disabled (SCHEDULER_ENABLED=false)")
        return None

    if _scheduler is not None:
        return _scheduler

    from apscheduler.schedulers.background import BackgroundScheduler

    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    scheduler = BackgroundScheduler(timezone="UTC", daemon=True)
    scheduler.add_job(
        _run_sweep,
        "interval",
        args=[connect],
        minutes=SWEEP_INTERVAL_MINUTES,
        id="presence_sweep",
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()

    _scheduler = scheduler
    return scheduler
