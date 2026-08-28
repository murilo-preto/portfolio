"""Account settings: password changes and stored preferences.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

import copy
import json

import bcrypt
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

import app

logger = logging.getLogger(__name__)

settings_bp = Blueprint("settings", __name__)


# Preferences used to live in the browser's localStorage, so they never
# followed a user to a second device. `user_preferences` (migration 002) holds
# theme and currency as typed columns and everything else as one JSON blob
# whose shape the client owns; Flask only guarantees the keys below exist on a
# read, so the UI never has to null-check a fresh account.
DEFAULT_PREFERENCE_SETTINGS = {
    "timerDailyTargets": {},
    "pomodoro": {
        "workMinutes": 25,
        "shortBreakMinutes": 5,
        "longBreakMinutes": 15,
        "sessionsBeforeLongBreak": 4,
    },
    "todoFilters": {},
    "lastUsed": {"category": None, "priority": None},
    # Which time category finished focus sessions are logged under, and
    # whether to log them at all. Off by default: silently writing time
    # entries on someone's behalf would be a surprise, not a feature.
    "focus": {"logToTimeEntries": False, "category": None},
}

DEFAULT_THEME = "system"
DEFAULT_CURRENCY = "BRL"
VALID_THEMES = ("system", "light", "dark")

# The blob is a convenience for small client-side settings, not a document
# store. A few hundred bytes is typical; the cap stops a runaway client from
# parking megabytes in a row that is read on every page load.
MAX_PREFERENCE_SETTINGS_BYTES = 16 * 1024

# bcrypt hashes at most 72 bytes and 4.x raises rather than truncating, so an
# over-long password is rejected as a validation error instead of a 500.
MAX_PASSWORD_BYTES = 72
MIN_PASSWORD_LENGTH = 6


SETTINGS_TOO_LARGE = (
    f"settings must serialize to at most {MAX_PREFERENCE_SETTINGS_BYTES} bytes"
)


def settings_within_limit(settings):
    """True when the blob fits the column budget once serialized."""
    return len(json.dumps(settings).encode("utf-8")) <= MAX_PREFERENCE_SETTINGS_BYTES


def decode_stored_settings(raw):
    """Read the `settings` JSON column back into a dict.

    Depending on the connector version a JSON column arrives already parsed or
    as the raw text; anything else (NULL, a stored scalar, corrupt text) is
    treated as "no settings yet" rather than failing the request.
    """
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def merge_preference_settings(base, incoming):
    """Overlay `incoming` on `base`, one level deep.

    Shallow-merging nested dicts means a client that saves only
    `pomodoro.workMinutes` keeps the other three durations, so a stale tab
    cannot wipe settings it never knew about.
    """
    merged = copy.deepcopy(base)
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **value}
        else:
            merged[key] = value
    return merged


def preferences_payload(row):
    """The response body for a preferences row, or defaults when there is none."""
    if not row:
        return {
            "theme": DEFAULT_THEME,
            "currency": DEFAULT_CURRENCY,
            "settings": copy.deepcopy(DEFAULT_PREFERENCE_SETTINGS),
        }
    return {
        "theme": row["theme"] or DEFAULT_THEME,
        "currency": row["currency"] or DEFAULT_CURRENCY,
        "settings": merge_preference_settings(
            DEFAULT_PREFERENCE_SETTINGS, decode_stored_settings(row["settings"])
        ),
    }


@settings_bp.route("/user/password", methods=["POST"])
@jwt_required()
# The default key applies, which for a token-bearing request is the user — so
# these caps are per account, as they always read as though they were.
@app.limiter.limit("5 per minute")
@app.limiter.limit("20 per hour")
def change_password():
    """
    Change the authenticated user's password.

    The current password is required: a stolen access token alone must not be
    enough to lock the owner out of their own account. There is no token
    revocation list in this stack, so tokens issued before the change stay
    valid until they expire — stated here rather than silently implied.

    Expected JSON:
    {
        "current_password": "string",
        "new_password": "string"
    }

    Returns:
        200: Password changed
        400: Missing fields or validation error
        401: Current password is incorrect
        404: User not found
        500: Server error
    """
    data = request.get_json(silent=True)

    if not data or "current_password" not in data or "new_password" not in data:
        return jsonify(
            {"error": "Current password and new password are required"}
        ), 400

    current_password = data["current_password"]
    new_password = data["new_password"]

    if not isinstance(current_password, str) or not isinstance(new_password, str):
        return jsonify({"error": "Passwords must be strings"}), 400

    # Matches /register, so a password that could be registered can be set here.
    if not new_password or len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify(
            {"error": f"Password must be at least {MIN_PASSWORD_LENGTH} characters"}
        ), 400

    if len(new_password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        return jsonify(
            {"error": f"Password must be at most {MAX_PASSWORD_BYTES} bytes"}
        ), 400

    if new_password == current_password:
        return jsonify(
            {"error": "New password must be different from the current password"}
        ), 400

    username = get_jwt_identity()

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, pwd_hash FROM users WHERE username = %s", (username,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            stored_hash = bytes(user["pwd_hash"])
            current_bytes = current_password.encode("utf-8")

            # An over-long candidate cannot be the stored password anyway
            # (registration goes through the same bcrypt limit), and checkpw
            # would raise on it.
            if len(current_bytes) > MAX_PASSWORD_BYTES or not bcrypt.checkpw(
                current_bytes, stored_hash
            ):
                return jsonify({"error": "Current password is incorrect"}), 401

            new_hash = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt())

            cursor.execute(
                "UPDATE users SET pwd_hash = %s WHERE id = %s",
                (new_hash, user["id"]),
            )

        return jsonify({"message": "Password updated successfully"}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to change password"}), 500


@settings_bp.route("/user/preferences", methods=["GET"])
@jwt_required()
def get_user_preferences():
    """
    Read the authenticated user's preferences.

    A user who has never saved anything has no row; defaults are returned
    rather than a 404, so the client always receives a complete object.

    Returns:
        200: {"username", "theme", "currency", "settings"}
        404: User not found
        500: Server error
    """
    username = get_jwt_identity()

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT theme, currency, settings
                FROM user_preferences
                WHERE user_id = %s
                """,
                (user["id"],),
            )
            row = cursor.fetchone()

        return jsonify({"username": username, **preferences_payload(row)}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch preferences"}), 500


@settings_bp.route("/user/preferences", methods=["PUT"])
@jwt_required()
def update_user_preferences():
    """
    Update the authenticated user's preferences.

    Every field is optional and only what is sent is changed, so the pomodoro
    page can persist its own settings without first reading — and then
    overwriting — the timer's.

    Expected JSON (all keys optional):
    {
        "theme": "system" | "light" | "dark",
        "currency": "BRL",
        "settings": { ... }   # shallow-merged into what is stored
    }

    Returns:
        200: The full preferences after the update
        400: Validation error
        404: User not found
        500: Server error
    """
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "A JSON object is required"}), 400

    theme = data.get("theme")
    if theme is not None and theme not in VALID_THEMES:
        return jsonify(
            {"error": f"theme must be one of: {', '.join(VALID_THEMES)}"}
        ), 400

    currency = data.get("currency")
    if currency is not None:
        if (
            not isinstance(currency, str)
            or len(currency.strip()) != 3
            or not currency.strip().isalpha()
        ):
            return jsonify({"error": "currency must be a 3-letter ISO 4217 code"}), 400
        currency = currency.strip().upper()

    incoming_settings = data.get("settings")
    if incoming_settings is not None:
        if not isinstance(incoming_settings, dict):
            return jsonify({"error": "settings must be an object"}), 400
        if not settings_within_limit(incoming_settings):
            return jsonify({"error": SETTINGS_TOO_LARGE}), 400

    username = get_jwt_identity()

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            # Read-modify-write inside the single transaction get_cursor opens,
            # so a partial update never merges onto a row another request is
            # halfway through replacing.
            cursor.execute(
                """
                SELECT theme, currency, settings
                FROM user_preferences
                WHERE user_id = %s
                FOR UPDATE
                """,
                (user["id"],),
            )
            row = cursor.fetchone()
            current = preferences_payload(row)

            next_theme = theme if theme is not None else current["theme"]
            next_currency = currency if currency is not None else current["currency"]
            next_settings = (
                merge_preference_settings(current["settings"], incoming_settings)
                if incoming_settings is not None
                else current["settings"]
            )

            # The merge result can exceed the cap even when the patch alone did
            # not, so the stored object is checked too.
            if not settings_within_limit(next_settings):
                return jsonify({"error": SETTINGS_TOO_LARGE}), 400

            cursor.execute(
                """
                INSERT INTO user_preferences (user_id, theme, currency, settings)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    theme = VALUES(theme),
                    currency = VALUES(currency),
                    settings = VALUES(settings)
                """,
                (user["id"], next_theme, next_currency, json.dumps(next_settings)),
            )

        return jsonify(
            {
                "message": "Preferences updated",
                "username": username,
                "theme": next_theme,
                "currency": next_currency,
                "settings": next_settings,
            }
        ), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update preferences"}), 500

