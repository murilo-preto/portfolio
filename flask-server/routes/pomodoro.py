"""Focus sessions, and what completing one writes elsewhere.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

from routes.entries import MAX_NOTE_LENGTH

import app

logger = logging.getLogger(__name__)

pomodoro_bp = Blueprint("pomodoro", __name__)


@pomodoro_bp.route("/pomodoro/start", methods=["POST"])
@jwt_required()
def start_pomodoro_session():
    """
    Start a new Pomodoro session.

    Expected JSON:
    {
        "todo_id": int (optional),
        "session_type": "pomodoro" | "short_break" | "long_break" (optional, default: "pomodoro")
    }

    Returns:
        201: Session started with session_id
        400: Validation error
        404: User or TODO item not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json() or {}
    todo_id = data.get("todo_id")
    session_type = data.get("session_type", "pomodoro")

    valid_session_types = ("pomodoro", "short_break", "long_break")
    if session_type not in valid_session_types:
        return jsonify(
            {"error": f"session_type must be one of: {', '.join(valid_session_types)}"}
        ), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            # Verify TODO item if provided
            if todo_id is not None:
                cursor.execute(
                    """
                    SELECT ti.id FROM todo_items ti
                    JOIN users u ON ti.user_id = u.id
                    WHERE ti.id = %s AND u.username = %s
                    """,
                    (todo_id, current_user),
                )
                todo = cursor.fetchone()

                if not todo:
                    return jsonify({"error": "TODO item not found or access denied"}), 404

            # Self-heal: no scheduler exists to sweep abandoned sessions, so
            # any session left dangling in 'in_progress' (refresh, tab close,
            # crash) is cancelled the next time this user starts a new one.
            cursor.execute(
                """
                UPDATE pomodoro_sessions
                SET status = 'cancelled'
                WHERE user_id = %s AND status = 'in_progress'
                """,
                (user["id"],),
            )

            # Create session record
            cursor.execute(
                """
                INSERT INTO pomodoro_sessions (user_id, todo_id, session_type, duration_seconds, status, session_date)
                VALUES (%s, %s, %s, 0, 'in_progress', %s)
                """,
                (user["id"], todo_id, session_type, datetime.now(timezone.utc)),
            )
            session_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Pomodoro session started",
                "session_id": session_id,
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to start Pomodoro session"}), 500


# ─── Task ↔ time linking ──────────────────────────────────────────────────────

# A focus session is worth more than its row in pomodoro_sessions: for anyone
# who also tracks time, it is 25 minutes of "Work" that the entries dashboard
# would otherwise never see, and 25 minutes of visible progress on the task it
# was aimed at. The two helpers below run when a focus session completes.
#
# Both are deliberately soft about *caller-fixable* problems — a category the
# user has since deleted, a task deleted mid-session, a zero-length session.
# Completing the pomodoro is the irreversible thing the user just earned, so it
# must not fail because a piece of bookkeeping could not be attached; the
# reason comes back in the response body instead. A genuine database error
# still propagates, rolling the whole thing back, because a half-written
# transaction is worse than a 500.


def log_focus_session_as_time_entry(
    cursor, user_id, category_name, duration_seconds, finished_at, note
):
    """Materialise a completed focus session as a time entry.

    Returns (entry_id, None) on success, or (None, reason) when there is
    nothing sensible to write. The entry spans backwards from `finished_at`,
    which is the only interval the server can reconstruct — the client reports
    a duration, not a start.
    """
    if duration_seconds <= 0:
        return None, "Session was too short to log as a time entry"

    name = (category_name or "").strip()
    if not name:
        return None, "No category selected for time logging"

    cursor.execute("SELECT id FROM category WHERE name = %s", (name,))
    category = cursor.fetchone()
    if not category:
        return None, f"Category {name!r} no longer exists"

    start_time = finished_at - timedelta(seconds=duration_seconds)
    cursor.execute(
        """
        INSERT INTO time_entries (user_id, category_id, start_time, end_time, note)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (user_id, category["id"], start_time, finished_at, note),
    )
    return cursor.lastrowid, None


def advance_linked_todo(cursor, user_id, todo_id):
    """Move the task a finished focus session was aimed at out of `pending`.

    Finishing a pomodoro on a task is proof the task is underway, so the bump
    to `in_progress` needs no prompting. Marking it *done* deliberately is not
    done here: that decision belongs to the user after the session, and it goes
    through PUT /todo/<id>, which is also what spawns the next occurrence of a
    recurring task. Duplicating the completion here would skip that.

    Returns the item's status after the call, or None when there is no such
    item to advance. A task deleted mid-session does not reach here — the FK on
    pomodoro_sessions.todo_id is ON DELETE SET NULL, so the link is already
    gone; the None case guards against a caller that has not checked ownership.
    """
    cursor.execute(
        "SELECT id, status FROM todo_items WHERE id = %s AND user_id = %s",
        (todo_id, user_id),
    )
    item = cursor.fetchone()
    if not item:
        return None

    if item["status"] == "pending":
        cursor.execute(
            "UPDATE todo_items SET status = 'in_progress' WHERE id = %s", (todo_id,)
        )
        return "in_progress"

    return item["status"]


@pomodoro_bp.route("/pomodoro/complete", methods=["POST"])
@jwt_required()
def complete_pomodoro_session():
    """
    Complete a Pomodoro session.

    Expected JSON:
    {
        "session_id": int,
        "duration_seconds": int,
        "category": "string" (optional) — log the session as a time entry
                    under this time category. Focus sessions only.
    }

    A focus session linked to a task also moves that task out of `pending`;
    see advance_linked_todo. Neither extra can fail the completion itself, so
    the response reports what actually happened:

    {
        "message": ..., "id": int,
        "time_entry_id": int | null,
        "time_entry_error": "string" (only when logging was asked for and skipped),
        "todo_id": int | null,
        "todo_status": "string" | null
    }

    Returns:
        200: Session completed
        400: Validation error
        404: Session not found (or not this user's, or already resolved)
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    session_id = data.get("session_id")
    duration_seconds = data.get("duration_seconds")
    category_name = data.get("category")

    if not session_id or duration_seconds is None:
        return jsonify({"error": "session_id and duration_seconds are required"}), 400

    if category_name is not None and not isinstance(category_name, str):
        return jsonify({"error": "category must be a string"}), 400

    try:
        duration_seconds = int(duration_seconds)
        if duration_seconds < 0:
            return jsonify({"error": "duration_seconds must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "duration_seconds must be an integer"}), 400

    finished_at = datetime.now(timezone.utc)

    try:
        with app.get_cursor() as cursor:
            # Verify session belongs to this user and is still in progress
            # (prevents double-completing an already-resolved session)
            cursor.execute(
                """
                SELECT ps.id, ps.user_id, ps.todo_id, ps.session_type
                FROM pomodoro_sessions ps
                JOIN users u ON ps.user_id = u.id
                WHERE ps.id = %s AND u.username = %s AND ps.status = 'in_progress'
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute(
                """
                UPDATE pomodoro_sessions
                SET duration_seconds = %s, status = 'completed'
                WHERE id = %s
                """,
                (duration_seconds, session_id),
            )

            is_focus = session["session_type"] == "pomodoro"
            todo_id = session["todo_id"]
            todo_title = None
            todo_status = None

            if is_focus and todo_id is not None:
                todo_status = advance_linked_todo(
                    cursor, session["user_id"], todo_id
                )
                if todo_status is None:
                    # Not this user's task after all; report no link rather
                    # than a task the response has no business naming.
                    todo_id = None
                else:
                    cursor.execute(
                        "SELECT title FROM todo_items WHERE id = %s", (todo_id,)
                    )
                    row = cursor.fetchone()
                    todo_title = row["title"] if row else None

            time_entry_id = None
            time_entry_error = None

            if category_name is not None:
                if not is_focus:
                    time_entry_error = "Only focus sessions are logged as time entries"
                else:
                    note = todo_title[:MAX_NOTE_LENGTH] if todo_title else None
                    time_entry_id, time_entry_error = log_focus_session_as_time_entry(
                        cursor,
                        session["user_id"],
                        category_name,
                        duration_seconds,
                        finished_at,
                        note,
                    )

        payload = {
            "message": "Pomodoro session completed",
            "id": session_id,
            "time_entry_id": time_entry_id,
            "todo_id": todo_id,
            "todo_status": todo_status,
        }
        if time_entry_error:
            payload["time_entry_error"] = time_entry_error

        return jsonify(payload), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to complete Pomodoro session"}), 500


@pomodoro_bp.route("/pomodoro/cancel", methods=["POST"])
@jwt_required()
def cancel_pomodoro_session():
    """
    Cancel a Pomodoro session (soft-cancel, preserving history).

    Expected JSON:
    {
        "session_id": int
    }

    Returns:
        200: Session cancelled
        400: Validation error
        403: Not owner of session
        404: Session not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "session_id" not in data:
        return jsonify({"error": "session_id is required"}), 400

    session_id = data["session_id"]

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                """
                SELECT ps.id FROM pomodoro_sessions ps
                JOIN users u ON ps.user_id = u.id
                WHERE ps.id = %s AND u.username = %s AND ps.status = 'in_progress'
                """,
                (session_id, current_user),
            )
            session = cursor.fetchone()

            if not session:
                return jsonify({"error": "Session not found or access denied"}), 404

            cursor.execute(
                "UPDATE pomodoro_sessions SET status = 'cancelled' WHERE id = %s",
                (session_id,),
            )

        return jsonify({"message": "Pomodoro session cancelled", "id": session_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to cancel Pomodoro session"}), 500


def retrieve_pomodoro_sessions_from_username(username):
    """Helper function to fetch Pomodoro sessions for a user."""
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                """
                SELECT
                    ps.id,
                    ps.todo_id,
                    ti.title AS todo_title,
                    ps.session_type,
                    ps.duration_seconds,
                    ps.status,
                    ps.session_date,
                    ps.created_at
                FROM pomodoro_sessions ps
                LEFT JOIN todo_items ti ON ps.todo_id = ti.id
                WHERE ps.user_id = %s
                ORDER BY ps.session_date DESC
                LIMIT 100
                """,
                (user["id"],),
            )
            sessions = cursor.fetchall()

            # Convert datetime objects to strings
            for session in sessions:
                for field in ["session_date", "created_at"]:
                    if session[field] is not None:
                        session[field] = session[field].isoformat()

        return jsonify({"username": username, "sessions": sessions}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch Pomodoro sessions"}), 500


@pomodoro_bp.get("/pomodoro/sessions")
@jwt_required()
def my_pomodoro_sessions():
    """
    Retrieves Pomodoro sessions from a user from token username
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    return retrieve_pomodoro_sessions_from_username(username)


@pomodoro_bp.get("/pomodoro/stats")
@jwt_required()
def pomodoro_stats():
    """
    Get Pomodoro statistics for the current user.

    Returns:
        200: Statistics including total sessions, total time, today's sessions, etc.
        400: Username required
        500: Server error
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            user_id = user["id"]

            # Total focus (pomodoro) sessions
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                """,
                (user_id,),
            )
            total_stats = cursor.fetchone()

            # Today's focus sessions
            today = datetime.now(timezone.utc).date()
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                AND DATE(session_date) = %s
                """,
                (user_id, today),
            )
            today_stats = cursor.fetchone()

            # This week's focus sessions (last 7 days)
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed' AND session_type = 'pomodoro'
                AND session_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                """,
                (user_id,),
            )
            week_stats = cursor.fetchone()

            # Today's break time (short + long breaks), kept separate so it
            # doesn't dilute the "focus time" numbers above
            cursor.execute(
                """
                SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds), 0) as total_seconds
                FROM pomodoro_sessions
                WHERE user_id = %s AND status = 'completed'
                AND session_type IN ('short_break', 'long_break')
                AND DATE(session_date) = %s
                """,
                (user_id, today),
            )
            break_stats = cursor.fetchone()

        return jsonify({
            "username": username,
            "stats": {
                "total": {
                    "sessions": total_stats["count"],
                    "total_seconds": int(total_stats["total_seconds"]),
                },
                "today": {
                    "sessions": today_stats["count"],
                    "total_seconds": int(today_stats["total_seconds"]),
                },
                "week": {
                    "sessions": week_stats["count"],
                    "total_seconds": int(week_stats["total_seconds"]),
                },
                "today_breaks": {
                    "sessions": break_stats["count"],
                    "total_seconds": int(break_stats["total_seconds"]),
                },
            },
        }), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch Pomodoro stats"}), 500
