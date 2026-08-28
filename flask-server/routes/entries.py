"""Time entries: the log itself, plus the shared shape of an entry row.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

from query_params import (
    ListQuery,
    QueryParamError,
    build_filters,
    build_order,
    build_page,
    page_meta,
    parse_list_query,
)

import app

logger = logging.getLogger(__name__)

entries_bp = Blueprint("entries", __name__)

MAX_NOTE_LENGTH = 255


def clean_entry_note(raw):
    """Normalise an optional time-entry note.

    Blank in any form collapses to None, so "no note" is one value in the
    database rather than a mix of NULL and "". Raises ValueError with a
    caller-safe message, which the batch importer reports per row and the
    single-entry routes turn into a 400.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError("note must be a string")
    note = raw.strip()
    if not note:
        return None
    if len(note) > MAX_NOTE_LENGTH:
        raise ValueError(f"note must be at most {MAX_NOTE_LENGTH} characters")
    return note


# What `?sort=` may name on /entry, and the SQL each name means. Callers never
# supply column text; they pick a key from here.
ENTRY_SORTABLE = {
    "start_time": "te.start_time",
    "end_time": "te.end_time",
    "category": "c.name",
    "duration": "TIMESTAMPDIFF(SECOND, te.start_time, te.end_time)",
    "note": "te.note",
}

ENTRY_DEFAULT_ORDER = "te.start_time ASC"


def retrieve_entry_from_username(username, query=None):
    # An empty ListQuery *is* the unfiltered, unpaginated request, so callers
    # outside a request context (and the tests) can keep passing a username
    # alone and get the original behaviour.
    query = query or ListQuery()
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            where, filter_params = build_filters(
                query,
                date_column="te.start_time",
                category_column="c.name",
                search_columns=("te.note", "c.name"),
            )
            order = build_order(
                query, ENTRY_SORTABLE, ENTRY_DEFAULT_ORDER, "te.id"
            )
            page, page_params = build_page(query)

            cursor.execute(
                f"""
                SELECT
                    te.id,
                    c.name AS category,
                    te.start_time,
                    te.end_time,
                    te.note,
                    TIMESTAMPDIFF(SECOND, te.start_time, te.end_time) AS duration_seconds
                FROM time_entries te
                JOIN category c ON te.category_id = c.id
                WHERE te.user_id = %s{where}
                {order}
                {page}
                """,
                tuple([user["id"], *filter_params, *page_params]),
            )
            entries = cursor.fetchall()

            body = {"username": username, "entries": entries}

            # The count only matters to a caller paging through a window, and
            # it costs a second scan, so unpaginated requests don't pay for it.
            if query.paginated:
                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM time_entries te
                    JOIN category c ON te.category_id = c.id
                    WHERE te.user_id = %s{where}
                    """,
                    tuple([user["id"], *filter_params]),
                )
                body["page"] = page_meta(query, cursor.fetchone()["total"])

        return jsonify(body), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch entries"}), 500


@entries_bp.get("/entry")
@jwt_required()
def myentries():
    """
    Retrieves entries from a user from token username.

    Optional query parameters (see query_params.py):
        from, to       ISO date or datetime bounds on start_time
        category       exact category name
        q              substring of the note or the category name
        sort           start_time | end_time | category | duration | note
        direction      asc | desc
        limit, offset  window; a windowed response also carries a "page" block

    With none of them the response is exactly what it has always been: every
    entry, oldest first, unpaginated.
    """

    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    try:
        query = parse_list_query(request.args, ENTRY_SORTABLE)
    except QueryParamError as e:
        return jsonify({"error": str(e)}), 400

    return retrieve_entry_from_username(username, query)


@entries_bp.route("/entry/create", methods=["POST"])
@jwt_required()
def create_time_entry():
    """
    Create a new time entry.

    Expected JSON:
    {
        "username": "string",
        "category": "string",
        "start_time": "YYYY-MM-DD HH:MM:SS",
        "end_time": "YYYY-MM-DD HH:MM:SS",
        "note": "string" (optional, max 255 chars)
    }

    Returns:
        201: Entry created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    data = request.get_json()

    username = get_jwt_identity()
    required_fields = ["category", "start_time", "end_time"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "category, start_time and end_time are required"}
        ), 400
    category_name = data["category"].strip()
    start_time_str = data["start_time"]
    end_time_str = data["end_time"]

    try:
        note = clean_entry_note(data.get("note"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

        if start_time.tzinfo is None or end_time.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400

        start_time = start_time.astimezone(timezone.utc)
        end_time = end_time.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    if end_time <= start_time:
        return jsonify({"error": "end_time must be after start_time"}), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute("SELECT id FROM category WHERE name = %s", (category_name,))
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], start_time, end_time, note),
            )
            entry_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Time entry created successfully",
                "entry": {
                    "id": entry_id,
                    "username": username,
                    "category": category_name,
                    "start_time": start_time_str,
                    "end_time": end_time_str,
                    "note": note,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create time entry"}), 500


@entries_bp.route("/entry/<int:entry_id>", methods=["PUT"])
@jwt_required()
def update_time_entry(entry_id):
    """
    Update an existing time entry.

    Expected JSON:
    {
        "category": "string",
        "start_time": "YYYY-MM-DD HH:MM:SS",
        "end_time": "YYYY-MM-DD HH:MM:SS",
        "note": "string" (optional, max 255 chars)
    }

    Omitting "note" leaves the stored note untouched; sending it null or blank
    clears it. A client that predates notes therefore cannot wipe one just by
    round-tripping an entry.

    Returns:
        200: Entry updated
        400: Validation error
        403: Not owner of entry
        404: Entry or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    category_name = data.get("category", "").strip()
    start_time_str = data.get("start_time")
    end_time_str = data.get("end_time")

    if not category_name or not start_time_str or not end_time_str:
        return jsonify({"error": "category, start_time and end_time are required"}), 400

    note_provided = "note" in data
    note = None
    if note_provided:
        try:
            note = clean_entry_note(data["note"])
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    try:
        start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

        if start_time.tzinfo is None or end_time.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400

        start_time = start_time.astimezone(timezone.utc)
        end_time = end_time.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    if end_time <= start_time:
        return jsonify({"error": "end_time must be after start_time"}), 400

    try:
        with app.get_cursor() as cursor:
            # Verify entry belongs to this user
            cursor.execute(
                """
                SELECT te.id FROM time_entries te
                JOIN users u ON te.user_id = u.id
                WHERE te.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            # Resolve category
            cursor.execute("SELECT id FROM category WHERE name = %s", (category_name,))
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            assignments = ["category_id = %s", "start_time = %s", "end_time = %s"]
            values = [category["id"], start_time, end_time]
            if note_provided:
                assignments.append("note = %s")
                values.append(note)
            values.append(entry_id)

            cursor.execute(
                f"UPDATE time_entries SET {', '.join(assignments)} WHERE id = %s",
                tuple(values),
            )

        return jsonify({"message": "Entry updated successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update entry"}), 500


@entries_bp.route("/entry/delete", methods=["DELETE"])
@jwt_required()
def delete_time_entry():
    """
    Delete a time entry by entry_id.

    Expects JSON:
    {
        "entry_id": int
    }

    Returns:
        200: Entry deleted
        400: Validation error
        403: Not owner of entry
        404: Entry not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entry_id" not in data:
        return jsonify({"error": "entry_id is required"}), 400

    entry_id = data["entry_id"]

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                """
                SELECT te.id FROM time_entries te
                JOIN users u ON te.user_id = u.id
                WHERE te.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            cursor.execute("DELETE FROM time_entries WHERE id = %s", (entry_id,))

        return jsonify({"message": "Entry deleted successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete entry"}), 500


@entries_bp.route("/entry/batch-import", methods=["POST"])
@jwt_required()
def batch_import_time_entries():
    """
    Batch import multiple time entries from a single request.

    Expected JSON:
    {
        "entries": [
            {
                "category": "string",
                "start_time": "YYYY-MM-DD HH:MM:SS",
                "end_time": "YYYY-MM-DD HH:MM:SS",
                "note": "string" (optional, max 255 chars)
            },
            ...
        ]
    }

    Returns:
        200: { success: number, failed: number, errors: Array<{index, error}> }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entries" not in data:
        return jsonify({"error": "entries array is required"}), 400

    entries = data["entries"]
    if not isinstance(entries, list):
        return jsonify({"error": "entries must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
        if not user:
            return jsonify({"error": "User not found"}), 404
        user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    # First, get or create all categories
    category_cache = {}
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM category")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"]] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    for i, entry in enumerate(entries):
        try:
            category_name = entry.get("category", "").strip()
            start_time_str = entry.get("start_time")
            end_time_str = entry.get("end_time")

            if not category_name or not start_time_str or not end_time_str:
                raise ValueError("category, start_time and end_time are required")

            note = clean_entry_note(entry.get("note"))

            # Parse and validate dates
            start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

            if start_time.tzinfo is None or end_time.tzinfo is None:
                raise ValueError("Timezone information required")

            start_time = start_time.astimezone(timezone.utc)
            end_time = end_time.astimezone(timezone.utc)

            if end_time <= start_time:
                raise ValueError("end_time must be after start_time")

            # Get or create category
            if category_name not in category_cache:
                with app.get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO category (name) VALUES (%s)",
                        (category_name,)
                    )
                    category_cache[category_name] = cursor.lastrowid

            category_id = category_cache[category_name]

            with app.get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, start_time, end_time, note)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to import entry {i}: {e}")

    return jsonify(results), 200

