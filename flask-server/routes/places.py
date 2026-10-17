"""Places: the pins whose geofences the Namu Android app watches.

A place is a name, a point, a radius and the time category its stays are logged
in. The web app manages them under the usual JWT. The phone only reads them,
with its device token, and only the enabled ones, since those are what it
registers geofences for.

Every value checked here is also checked by a constraint in migration 008. They
are checked first so bad input gets a 400 that says what is wrong rather than a
500 from the database.

Coordinates are stored encrypted, in `location_enc` (location_crypto.py, and
migration 013). They are encrypted on the way in and decrypted on the way out
here, and nowhere else, so neither the web app nor the phone sees the change.

Route modules reach shared state through `import app`; see routes/auth.py.
"""

import logging
import math

import mysql.connector
from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

from category_admin import coerce_id
from rate_limit import address_key
from routes.devices import DEVICE_ADDRESS_LIMIT, device_required
from users import resolve_user_id
import location_crypto
import presence

import app

logger = logging.getLogger(__name__)

places_bp = Blueprint("places", __name__)

MAX_PLACE_NAME_LENGTH = 100
MIN_RADIUS_M = 100
MAX_RADIUS_M = 2000
DEFAULT_RADIUS_M = 150

# Android lets one app register at most 100 geofences. A place beyond that could
# never be watched, so it is refused when created rather than silently ignored
# on the phone.
MAX_PLACES_PER_USER = 100

ER_DUP_ENTRY = 1062

_PLACE_COLUMNS = """
    p.id, p.user_id, p.name, p.category_id, c.name AS category, p.location_enc,
    p.radius_m, p.enabled
"""


def _place_json(row):
    latitude, longitude = location_crypto.decrypt(row["user_id"], row["location_enc"])
    return {
        "id": row["id"],
        "name": row["name"],
        "category_id": row["category_id"],
        "category": row["category"],
        "latitude": latitude,
        "longitude": longitude,
        "radius_m": row["radius_m"],
        "enabled": bool(row["enabled"]),
    }


def _encrypt_location(fields, user_id, before=None):
    """Swap latitude/longitude in `fields` for the encrypted column.

    An update may change only one of them; the other is taken from `before`,
    the place as stored, since both are sealed in one blob.
    """
    if "latitude" not in fields and "longitude" not in fields:
        return fields
    old_latitude = old_longitude = None
    if before is not None:
        old_latitude, old_longitude = location_crypto.decrypt(
            user_id, before["location_enc"]
        )
    latitude = fields.pop("latitude", old_latitude)
    longitude = fields.pop("longitude", old_longitude)
    fields["location_enc"] = location_crypto.encrypt(user_id, latitude, longitude)
    return fields


def _number(value):
    """A finite JSON number, or None. Booleans are ints to Python, not here."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _parse(data, partial):
    """Validate a create (partial=False) or update (partial=True) body.

    Returns (fields, error). `fields` holds only the keys present, cleaned, with
    a create's defaults filled in. category_id is checked for shape here and
    for ownership by the caller, which has the cursor.
    """
    if not isinstance(data, dict):
        return None, "Expected a JSON object"

    fields = {}

    if "name" in data or not partial:
        name = data.get("name")
        name = name.strip() if isinstance(name, str) else ""
        if not name or len(name) > MAX_PLACE_NAME_LENGTH:
            return None, (
                f"Place name must be between 1 and {MAX_PLACE_NAME_LENGTH} characters"
            )
        fields["name"] = name

    if "category_id" in data or not partial:
        category_id = coerce_id(data.get("category_id"))
        if category_id is None or isinstance(data.get("category_id"), str):
            return None, "category_id must be a category id"
        fields["category_id"] = category_id

    for key, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
        if key in data or not partial:
            value = _number(data.get(key))
            if value is None or not low <= value <= high:
                return None, f"{key} must be a number between {low} and {high}"
            # DECIMAL(9,6) would round it anyway; rounding here means the
            # response matches what a later read returns.
            fields[key] = round(value, 6)

    if "radius_m" in data:
        radius = data["radius_m"]
        if isinstance(radius, bool) or not isinstance(radius, int):
            radius = None
        if radius is None or not MIN_RADIUS_M <= radius <= MAX_RADIUS_M:
            return None, (
                f"radius_m must be a whole number of metres between "
                f"{MIN_RADIUS_M} and {MAX_RADIUS_M}"
            )
        fields["radius_m"] = radius
    elif not partial:
        fields["radius_m"] = DEFAULT_RADIUS_M

    if "enabled" in data:
        if not isinstance(data["enabled"], bool):
            return None, "enabled must be true or false"
        fields["enabled"] = data["enabled"]
    elif not partial:
        fields["enabled"] = True

    if partial and not fields:
        return None, "Nothing to update"

    return fields, None


def _owns_category(cursor, category_id, user_id):
    cursor.execute(
        "SELECT id FROM category WHERE id = %s AND user_id = %s",
        (category_id, user_id),
    )
    return cursor.fetchone() is not None


def _name_taken(cursor, user_id, name, except_id=None):
    cursor.execute(
        "SELECT id FROM places WHERE user_id = %s AND name = %s AND id <> %s",
        (user_id, name, except_id or 0),
    )
    return cursor.fetchone() is not None


def _load(cursor, place_id, user_id):
    cursor.execute(
        f"""
        SELECT {_PLACE_COLUMNS}
        FROM places p
        JOIN category c ON c.id = p.category_id
        WHERE p.id = %s AND p.user_id = %s
        """,
        (place_id, user_id),
    )
    return cursor.fetchone()


def enabled_places(cursor, user_id):
    """The user's enabled places, by name: what their phone should watch.

    Shared with routes/presence.py, which returns the same list after every
    batch of events so the phone's geofences follow edits made on the web.
    """
    cursor.execute(
        f"""
        SELECT {_PLACE_COLUMNS}
        FROM places p
        JOIN category c ON c.id = p.category_id
        WHERE p.user_id = %s AND p.enabled
        ORDER BY p.name
        """,
        (user_id,),
    )
    return [_place_json(row) for row in cursor.fetchall()]


def _name_taken_error(name):
    return jsonify({"error": f'You already have a place named "{name}"'}), 409


# ─── The web app's side ───────────────────────────────────────────────────────


@places_bp.route("/places", methods=["GET"])
@jwt_required()
def list_places():
    """
    The caller's places, by name, disabled ones included.

    Returns:
        200: {"places": [...]}
        404: The token's user no longer exists
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            cursor.execute(
                f"""
                SELECT {_PLACE_COLUMNS}
                FROM places p
                JOIN category c ON c.id = p.category_id
                WHERE p.user_id = %s
                ORDER BY p.name
                """,
                (user_id,),
            )
            rows = cursor.fetchall()
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load places"}), 500

    return jsonify({"places": [_place_json(row) for row in rows]}), 200


@places_bp.route("/places", methods=["POST"])
@jwt_required()
def create_place():
    """
    Create a place.

    Expected JSON:
    {
        "name": "string",
        "category_id": int,
        "latitude": number,
        "longitude": number,
        "radius_m": int (optional, 100-2000, default 150),
        "enabled": bool (optional, default true)
    }

    Returns:
        201: Created, with the place
        400: Validation error
        404: User or category not found (another user's category included)
        409: Name already used, or the 100-place limit reached
        500: Server error
    """
    fields, error = _parse(request.get_json(silent=True), partial=False)
    if error:
        return jsonify({"error": error}), 400

    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            if not _owns_category(cursor, fields["category_id"], user_id):
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                "SELECT COUNT(*) AS n FROM places WHERE user_id = %s", (user_id,)
            )
            if cursor.fetchone()["n"] >= MAX_PLACES_PER_USER:
                return jsonify(
                    {"error": f"You can have at most {MAX_PLACES_PER_USER} places"}
                ), 409

            if _name_taken(cursor, user_id, fields["name"]):
                return _name_taken_error(fields["name"])

            cursor.execute(
                """
                INSERT INTO places
                  (user_id, category_id, name, location_enc, radius_m, enabled)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    fields["category_id"],
                    fields["name"],
                    location_crypto.encrypt(
                        user_id, fields["latitude"], fields["longitude"]
                    ),
                    fields["radius_m"],
                    fields["enabled"],
                ),
            )
            place = _load(cursor, cursor.lastrowid, user_id)
    except mysql.connector.IntegrityError as e:
        # A concurrent create claimed the name between the check and the insert.
        if e.errno == ER_DUP_ENTRY:
            return _name_taken_error(fields["name"])
        logger.error(f"Place constraint violation: {e}")
        return jsonify({"error": "Could not create place"}), 500
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not create place"}), 500

    return jsonify({"message": "Place created", "place": _place_json(place)}), 201


@places_bp.route("/places/<int:place_id>", methods=["PATCH"])
@jwt_required()
def update_place(place_id):
    """
    Change any of a place's fields. Only the keys sent are changed.

    Expected JSON: any of name, category_id, latitude, longitude, radius_m,
    enabled, with the rules of POST /places.

    Pausing a place (enabled true to false) finalizes a stay in progress there,
    writing its time entry, in the same transaction.

    Returns:
        200: Updated, with the place
        400: Validation error, or nothing to update
        404: User, place or category not found (another user's included)
        409: Name already used by another of the caller's places
        500: Server error
    """
    fields, error = _parse(request.get_json(silent=True), partial=True)
    if error:
        return jsonify({"error": error}), 400

    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            before = _load(cursor, place_id, user_id)
            if not before:
                return jsonify({"error": "Place not found"}), 404
            if "category_id" in fields and not _owns_category(
                cursor, fields["category_id"], user_id
            ):
                return jsonify({"error": "Category not found"}), 404
            if "name" in fields and _name_taken(
                cursor, user_id, fields["name"], except_id=place_id
            ):
                return _name_taken_error(fields["name"])

            # Column names come from _parse's fixed keys, never from the body.
            columns = _encrypt_location(dict(fields), user_id, before)
            assignments = ", ".join(f"{column} = %s" for column in columns)
            cursor.execute(
                f"UPDATE places SET {assignments} WHERE id = %s AND user_id = %s",
                (*columns.values(), place_id, user_id),
            )
            if before["enabled"] and fields.get("enabled") is False:
                # Pausing a place ends a stay there now, with its entry. The
                # phone stops watching it, so no exit would ever arrive.
                presence.close_stay_at_place(cursor, user_id, place_id)
            place = _load(cursor, place_id, user_id)
    except mysql.connector.IntegrityError as e:
        if e.errno == ER_DUP_ENTRY:
            return _name_taken_error(fields["name"])
        logger.error(f"Place constraint violation: {e}")
        return jsonify({"error": "Could not update place"}), 500
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not update place"}), 500

    return jsonify({"message": "Place updated", "place": _place_json(place)}), 200


@places_bp.route("/places/<int:place_id>", methods=["DELETE"])
@jwt_required()
def delete_place(place_id):
    """
    Delete a place. Its recorded events and any stay still open there go with
    it (the foreign keys cascade); time entries already written stay.

    Returns:
        200: Deleted
        404: User or place not found (another user's included)
        500: Server error
    """
    try:
        with app.get_cursor() as cursor:
            user_id = resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404
            cursor.execute(
                "DELETE FROM places WHERE id = %s AND user_id = %s",
                (place_id, user_id),
            )
            if cursor.rowcount == 0:
                return jsonify({"error": "Place not found"}), 404
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not delete place"}), 500

    return jsonify({"message": "Place deleted", "id": place_id}), 200


# ─── The phone's side ─────────────────────────────────────────────────────────


@places_bp.route("/devices/me/places", methods=["GET"])
@app.limiter.limit(DEVICE_ADDRESS_LIMIT, key_func=address_key)
@device_required
def list_device_places():
    """
    The enabled places of the account this phone is paired with: the ones it
    should watch.

    Returns:
        200: {"places": [...]}
        401: Missing, invalid or revoked device token
    """
    try:
        with app.get_cursor() as cursor:
            places = enabled_places(cursor, g.device["user_id"])
    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Could not load places"}), 500

    return jsonify({"places": places}), 200
