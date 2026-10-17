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

The web app reads the same stay, can end it early (the only remedy when a phone
dies inside a place and would otherwise run to the cap), and lists the recent
events, under the browser's JWT.

Route modules reach shared state through `import app`; see routes/auth.py.
"""

import logging

import mysql.connector
from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

from rate_limit import address_key
from routes.devices import DEVICE_ADDRESS_LIMIT, device_required
from routes.places import enabled_places
from users import resolve_user_id
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


# ─── The web app's side ───────────────────────────────────────────────────────

EVENTS_DEFAULT_LIMIT = 20
EVENTS_MAX_LIMIT = 100


@presence_bp.route("/presence/stay", methods=["GET"])
@jwt_required()
def web_stay():
    """
    The caller's stay in progress, after settling anything time has decided,
    so the page never shows a stay that is already over.

    Returns:
        200: {"stay": {...} | null}, as GET /devices/me/stay
        404: The token's user no longer exists
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            presence.lock_user(cursor, user_id)
            presence.settle(cursor, user_id)
            stay = presence.stay_json(presence.load_stay(cursor, user_id))
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load stay"}), 500

    return jsonify({"stay": stay}), 200


@presence_bp.route("/presence/stay/end", methods=["POST"])
@jwt_required()
def web_end_stay():
    """
    End the caller's stay now and log it, for a phone that will never report
    leaving. A stay that already departed ends at its departure instead. The
    phone is not told: it still thinks it is inside, and the exit it reports
    later finds no stay and changes nothing.

    Returns:
        200: {"message", "entry_id"}. entry_id is null for a stay shorter than
             the minimum, which is discarded as usual
        404: No stay in progress, or the token's user no longer exists
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            ended = presence.end_stay(cursor, user_id)
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not end stay"}), 500

    if ended is None:
        return jsonify({"error": "No stay in progress"}), 404
    message = "Stay ended" if ended["entry_id"] else "Stay too short to log"
    return jsonify({"message": message, "entry_id": ended["entry_id"]}), 200


@presence_bp.route("/presence/events", methods=["GET"])
@jwt_required()
def web_events():
    """
    The caller's most recent enter/exit events, newest first: which place,
    which phone, when it happened and when the server heard of it. Never
    coordinates, which are not stored.

    Query: limit, 1-100 (default 20).

    Returns:
        200: {"events": [{"id", "kind", "place_id", "place_name", "device_id",
             "device_name", "occurred_at", "received_at"}]}. device_* are null
             once the phone's row is gone
        400: Bad limit
        404: The token's user no longer exists
    """
    raw = request.args.get("limit", str(EVENTS_DEFAULT_LIMIT))
    try:
        limit = int(raw)
    except ValueError:
        limit = 0
    if not 1 <= limit <= EVENTS_MAX_LIMIT:
        return jsonify(
            {"error": f"limit must be a whole number from 1 to {EVENTS_MAX_LIMIT}"}
        ), 400

    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            cursor.execute(
                """
                SELECT e.id, e.kind, e.place_id, p.name AS place_name,
                       e.device_id, d.name AS device_name,
                       e.occurred_at, e.received_at
                FROM presence_events e
                JOIN places p ON p.id = e.place_id AND p.user_id = e.user_id
                LEFT JOIN devices d ON d.id = e.device_id AND d.user_id = e.user_id
                WHERE e.user_id = %s
                ORDER BY e.occurred_at DESC, e.id DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            rows = cursor.fetchall()
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load events"}), 500

    return jsonify(
        {
            "events": [
                {
                    "id": row["id"],
                    "kind": row["kind"],
                    "place_id": row["place_id"],
                    "place_name": row["place_name"],
                    "device_id": row["device_id"],
                    "device_name": row["device_name"],
                    "occurred_at": presence.iso(row["occurred_at"]),
                    "received_at": presence.iso(row["received_at"]),
                }
                for row in rows
            ]
        }
    ), 200
