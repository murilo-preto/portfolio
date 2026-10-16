"""The phone's reports of arriving at and leaving places, and the stay they add up to.

The Namu app sends its geofence transitions in batches, from a queue it keeps
while offline, so a batch can be hours old and can repeat events it already
sent. Each event is recorded in presence_events, whose UNIQUE key on
(user_id, client_event_id) is the whole of the duplicate protection: a resent
event fails the insert and is answered "duplicate" without being applied again.
What the accepted events mean is decided in presence.py.

Every event is answered individually, so the phone can drop from its queue
exactly what the server has dealt with, and keep the rest. A malformed event is
"rejected" rather than failing the batch: resending it would never succeed, and
it must not hold up the good events behind it.

Route modules reach shared state through `import app`; see routes/auth.py.
"""

import logging

import mysql.connector
from flask import Blueprint, g, jsonify, request
from mysql.connector import Error

from rate_limit import address_key
from routes.devices import DEVICE_ADDRESS_LIMIT, device_required
from routes.places import enabled_places
import presence

import app

logger = logging.getLogger(__name__)

presence_bp = Blueprint("presence", __name__)

ER_DUP_ENTRY = 1062

KINDS = ("enter", "exit")


def _check(raw, places, now):
    """Validate one event. Returns (error, event); exactly one is None.

    `places` maps the caller's place ids, enabled or not, to their rows. Any
    other id, another user's included, is "Unknown place": a phone can hold a
    place for a while after it was deleted on the web.
    """
    if not isinstance(raw, dict):
        return "Each event must be an object", None

    client_event_id = presence.parse_client_event_id(raw.get("client_event_id"))
    if client_event_id is None:
        return "client_event_id must be a UUID", None

    place_id = raw.get("place_id")
    if isinstance(place_id, bool) or not isinstance(place_id, int):
        return "Unknown place", None
    place = places.get(place_id)
    if place is None:
        return "Unknown place", None

    kind = raw.get("kind")
    if kind not in KINDS:
        return "kind must be enter or exit", None

    occurred_at = presence.parse_occurred_at(raw.get("occurred_at"))
    if occurred_at is None:
        return "occurred_at must be an ISO 8601 time with a UTC offset", None
    if occurred_at > now + presence.FUTURE_TOLERANCE:
        return "occurred_at is in the future", None

    return None, {
        "client_event_id": client_event_id,
        "place": place,
        "kind": kind,
        "occurred_at": occurred_at,
    }


def _echo_id(raw):
    """The client_event_id as the phone sent it, so it can match the answer to
    its queue whatever form it used. None for an event that is not an object."""
    return raw.get("client_event_id") if isinstance(raw, dict) else None


@presence_bp.route("/devices/me/events", methods=["POST"])
@app.limiter.limit(DEVICE_ADDRESS_LIMIT, key_func=address_key)
@device_required
def report_events():
    """
    Record a batch of geofence events and apply them to the caller's stay.

    Expected JSON:
    {
        "events": [
            {
                "client_event_id": "uuid",
                "place_id": int,
                "kind": "enter" | "exit",
                "occurred_at": "ISO 8601 with an offset"
            }
        ]
    }

    Returns:
        200: {"results": [...], "stay": {...} | null, "places": [...]}.
             One result per event, in request order, with status "accepted",
             "duplicate" (already received; not applied again) or "rejected"
             (with an "error"). `places` is what GET /devices/me/places returns,
             so the phone can re-sync its geofences without another request
        400: Not an object, or events not a list of 1-100 items
        401: Missing, invalid or revoked device token
        500: Server error
    """
    data = request.get_json(silent=True)
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list) or not events:
        return jsonify({"error": "Expected a non-empty list of events"}), 400
    if len(events) > presence.MAX_EVENTS_PER_BATCH:
        return jsonify(
            {"error": f"At most {presence.MAX_EVENTS_PER_BATCH} events per request"}
        ), 400

    device = g.device
    user_id = device["user_id"]
    now = presence.now_utc()

    try:
        with app.get_cursor() as cursor:
            presence.lock_user(cursor, user_id)
            cursor.execute(
                "SELECT id, enabled FROM places WHERE user_id = %s", (user_id,)
            )
            places = {row["id"]: row for row in cursor.fetchall()}

            results = []
            accepted = []
            for raw in events:
                result = {"client_event_id": _echo_id(raw)}
                error, event = _check(raw, places, now)
                if error:
                    results.append({**result, "status": "rejected", "error": error})
                    continue
                try:
                    cursor.execute(
                        """
                        INSERT INTO presence_events
                          (user_id, place_id, device_id, client_event_id, kind,
                           occurred_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            user_id,
                            event["place"]["id"],
                            device["id"],
                            event["client_event_id"],
                            event["kind"],
                            event["occurred_at"],
                        ),
                    )
                except mysql.connector.IntegrityError as e:
                    # Inserting and catching, rather than checking first, is
                    # what makes a concurrent resend safe too.
                    if e.errno != ER_DUP_ENTRY:
                        raise
                    results.append({**result, "status": "duplicate"})
                    continue
                accepted.append({**event, "event_id": cursor.lastrowid})
                results.append({**result, "status": "accepted"})

            presence.apply_events(cursor, user_id, device["id"], accepted)
            presence.settle(cursor, user_id, now)

            cursor.execute(
                "UPDATE devices SET last_seen_at = %s WHERE id = %s",
                (now, device["id"]),
            )
            stay = presence.stay_json(presence.load_stay(cursor, user_id))
            current_places = enabled_places(cursor, user_id)
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not record events"}), 500

    return jsonify(
        {"results": results, "stay": stay, "places": current_places}
    ), 200


@presence_bp.route("/devices/me/stay", methods=["GET"])
@app.limiter.limit(DEVICE_ADDRESS_LIMIT, key_func=address_key)
@device_required
def current_stay():
    """
    The caller's stay in progress, after settling anything time has decided.

    Returns:
        200: {"stay": {"place_id", "place_name", "started_at", "departed_at"}
             | null}. departed_at is set while a departure waits out the
             re-entry window
        401: Missing, invalid or revoked device token
        500: Server error
    """
    user_id = g.device["user_id"]
    try:
        with app.get_cursor() as cursor:
            presence.lock_user(cursor, user_id)
            presence.settle(cursor, user_id)
            stay = presence.stay_json(presence.load_stay(cursor, user_id))
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load stay"}), 500

    return jsonify({"stay": stay}), 200
