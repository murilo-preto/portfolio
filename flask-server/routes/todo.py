"""Tasks, their categories and tags, and recurrence.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

import calendar
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

import category_admin
from query_params import (
    ListQuery,
    QueryParamError,
    build_filters,
    build_order,
    build_page,
    page_meta,
    parse_list_query,
)
from routes.categories import (
    _category_delete,
    _category_merge,
    _category_rename,
    _category_usage,
)

import app

logger = logging.getLogger(__name__)

todo_bp = Blueprint("todo", __name__)


def _next_recurrence_date(dt, rule):
    """Compute the next occurrence of dt for a given recurrence rule."""
    if rule == "daily":
        return dt + timedelta(days=1)
    if rule == "weekly":
        return dt + timedelta(weeks=1)
    if rule == "monthly":
        year = dt.year + (dt.month // 12)
        month = dt.month % 12 + 1
        day = min(dt.day, calendar.monthrange(year, month)[1])
        return dt.replace(year=year, month=month, day=day)
    return dt


def _resolve_or_create_tag_ids(cursor, tag_names):
    """Get-or-create each tag name and return their ids."""
    tag_ids = []
    for raw_name in tag_names:
        name = (raw_name or "").strip()
        if not name or len(name) > 50:
            continue
        cursor.execute("SELECT id FROM todo_tags WHERE name = %s", (name,))
        tag = cursor.fetchone()
        if not tag:
            cursor.execute("INSERT INTO todo_tags (name) VALUES (%s)", (name,))
            tag_id = cursor.lastrowid
        else:
            tag_id = tag["id"]
        tag_ids.append(tag_id)
    return tag_ids


def _set_todo_item_tags(cursor, item_id, tag_ids):
    """Replace the tag set for a TODO item."""
    cursor.execute("DELETE FROM todo_item_tags WHERE todo_id = %s", (item_id,))
    for tag_id in tag_ids:
        cursor.execute(
            "INSERT IGNORE INTO todo_item_tags (todo_id, tag_id) VALUES (%s, %s)",
            (item_id, tag_id),
        )


def _copy_todo_item_tags(cursor, from_item_id, to_item_id):
    cursor.execute(
        "SELECT tag_id FROM todo_item_tags WHERE todo_id = %s", (from_item_id,)
    )
    tag_ids = [row["tag_id"] for row in cursor.fetchall()]
    _set_todo_item_tags(cursor, to_item_id, tag_ids)


def _spawn_next_recurrence(cursor, item):
    """
    When a recurring TODO item is completed, insert its next occurrence.
    `item` must contain: user_id, category_id, title, description, priority,
    recurrence_rule, due_date, id.
    No-op if recurrence_rule is 'none', due_date is not set, or this item has
    already spawned an occurrence before (e.g. it was un-completed and
    completed again) — each occurrence spawns its successor at most once.
    """
    if item["recurrence_rule"] == "none" or item["due_date"] is None:
        return

    cursor.execute(
        "SELECT id FROM todo_items WHERE recurrence_parent_id = %s LIMIT 1",
        (item["id"],),
    )
    if cursor.fetchone():
        return

    next_due = _next_recurrence_date(item["due_date"], item["recurrence_rule"])

    cursor.execute(
        """
        INSERT INTO todo_items
            (user_id, category_id, title, description, priority, status,
             due_date, recurrence_rule, recurrence_parent_id)
        VALUES (%s, %s, %s, %s, %s, 'pending', %s, %s, %s)
        """,
        (
            item["user_id"],
            item["category_id"],
            item["title"],
            item["description"],
            item["priority"],
            next_due,
            item["recurrence_rule"],
            item["id"],
        ),
    )
    new_item_id = cursor.lastrowid
    _copy_todo_item_tags(cursor, item["id"], new_item_id)


# The priority ENUM sorts alphabetically (high, low, medium), which is not an
# order anyone means. This expression is both the default ordering and what
# `?sort=priority` maps to, so the two can never drift apart.
TODO_PRIORITY_ORDER = (
    "CASE ti.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END"
)

TODO_VALID_STATUSES = ("pending", "in_progress", "completed")
TODO_VALID_PRIORITIES = ("low", "medium", "high")


def parse_todo_extra_filters(args):
    """Parse the two filters unique to /todo into a (sql, params) pair.

    Returns a fragment beginning with " AND ", ready to append after the
    shared filters, or ("", []) when neither parameter is present.
    """
    clauses = []
    params = []

    if "status" in args:
        status = args["status"].strip()
        if status not in TODO_VALID_STATUSES:
            raise QueryParamError(
                f"status must be one of: {', '.join(TODO_VALID_STATUSES)}"
            )
        clauses.append("ti.status = %s")
        params.append(status)

    if "priority" in args:
        priority = args["priority"].strip()
        if priority not in TODO_VALID_PRIORITIES:
            raise QueryParamError(
                f"priority must be one of: {', '.join(TODO_VALID_PRIORITIES)}"
            )
        clauses.append("ti.priority = %s")
        params.append(priority)

    if not clauses:
        return "", []
    return " AND " + " AND ".join(clauses), params


TODO_SORTABLE = {
    "due_date": "ti.due_date",
    "priority": TODO_PRIORITY_ORDER,
    "status": "ti.status",
    "title": "ti.title",
    "category": "fc.name",
    "created_at": "ti.created_at",
    "updated_at": "ti.updated_at",
}

TODO_DEFAULT_ORDER = (
    f"{TODO_PRIORITY_ORDER}, ti.due_date ASC, ti.created_at DESC"
)


def retrieve_todo_items_from_username(username, query=None, extra_filters=None):
    """Helper function to fetch TODO items for a user."""
    query = query or ListQuery()
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            where, filter_params = build_filters(
                query,
                date_column="ti.due_date",
                category_column="fc.name",
                search_columns=("ti.title", "ti.description", "fc.name"),
            )
            # status and priority are the axes the To Do screen is actually
            # organised around, so they filter here rather than in the shared
            # helper, which only knows the parameters all three lists share.
            extra_sql, extra_params = extra_filters or ("", [])
            where += extra_sql
            filter_params.extend(extra_params)

            order = build_order(query, TODO_SORTABLE, TODO_DEFAULT_ORDER, "ti.id")
            page, page_params = build_page(query)

            cursor.execute(
                f"""
                SELECT
                    ti.id,
                    fc.name AS category,
                    ti.title,
                    ti.description,
                    ti.priority,
                    ti.status,
                    ti.due_date,
                    ti.recurrence_rule,
                    ti.recurrence_parent_id,
                    ti.completed_at,
                    ti.created_at,
                    ti.updated_at
                FROM todo_items ti
                JOIN todo_categories fc ON ti.category_id = fc.id
                WHERE ti.user_id = %s{where}
                {order}
                {page}
                """,
                tuple([user["id"], *filter_params, *page_params]),
            )
            items = cursor.fetchall()

            # Attach tags per item (single grouped query, no N+1)
            tags_by_item = {item["id"]: [] for item in items}
            focus_by_item = {item["id"]: (0, 0) for item in items}
            if items:
                item_ids = list(tags_by_item.keys())
                placeholders = ", ".join(["%s"] * len(item_ids))
                cursor.execute(
                    f"""
                    SELECT tit.todo_id, tt.id, tt.name
                    FROM todo_item_tags tit
                    JOIN todo_tags tt ON tit.tag_id = tt.id
                    WHERE tit.todo_id IN ({placeholders})
                    ORDER BY tt.name
                    """,
                    item_ids,
                )
                for row in cursor.fetchall():
                    tags_by_item[row["todo_id"]].append(
                        {"id": row["id"], "name": row["name"]}
                    )

                # How much focus each task has actually absorbed. Derived from
                # pomodoro_sessions rather than stored on the item, so it stays
                # correct without a counter to keep in sync; one grouped query
                # for the same reason as the tags above.
                cursor.execute(
                    f"""
                    SELECT todo_id,
                           COUNT(*) AS sessions,
                           COALESCE(SUM(duration_seconds), 0) AS seconds
                    FROM pomodoro_sessions
                    WHERE todo_id IN ({placeholders})
                      AND status = 'completed'
                      AND session_type = 'pomodoro'
                    GROUP BY todo_id
                    """,
                    item_ids,
                )
                for row in cursor.fetchall():
                    focus_by_item[row["todo_id"]] = (
                        int(row["sessions"]),
                        int(row["seconds"]),
                    )

            # Convert datetime objects to strings
            for item in items:
                for field in ["due_date", "completed_at", "created_at", "updated_at"]:
                    if item[field] is not None:
                        item[field] = item[field].isoformat()
                item["tags"] = tags_by_item[item["id"]]
                sessions, seconds = focus_by_item[item["id"]]
                item["focus_sessions"] = sessions
                item["focus_seconds"] = seconds

            body = {"username": username, "items": items}

            if query.paginated:
                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM todo_items ti
                    JOIN todo_categories fc ON ti.category_id = fc.id
                    WHERE ti.user_id = %s{where}
                    """,
                    tuple([user["id"], *filter_params]),
                )
                body["page"] = page_meta(query, cursor.fetchone()["total"])

        return jsonify(body), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO items"}), 500


@todo_bp.get("/todo")
@jwt_required()
def my_todo_items():
    """
    Retrieves TODO items from a user from token username.

    Optional query parameters (see query_params.py):
        from, to       ISO date or datetime bounds on due_date; items with no
                       due date are excluded by either bound, since an undated
                       item is not in any date range
        category       exact category name
        q              substring of the title, description or category name
        status         pending | in_progress | completed
        priority       low | medium | high
        sort           due_date | priority | status | title | category |
                       created_at | updated_at
        direction      asc | desc
        limit, offset  window; a windowed response also carries a "page" block

    With none of them the response is exactly what it has always been.
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    try:
        query = parse_list_query(request.args, TODO_SORTABLE)
        extra_filters = parse_todo_extra_filters(request.args)
    except QueryParamError as e:
        return jsonify({"error": str(e)}), 400

    return retrieve_todo_items_from_username(username, query, extra_filters)


@todo_bp.route("/todo/categories", methods=["GET"])
def list_todo_categories():
    """
    List all TODO categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_categories ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO categories"}), 500


@todo_bp.route("/todo/category", methods=["POST"])
@jwt_required()
def create_todo_category():
    """
    Create a new TODO category if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Category created
        200: Category already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Category name is required"}), 400

    name = data["name"].strip()

    if not name or len(name) > 100:
        return jsonify(
            {"error": "Category name must be between 1 and 100 characters"}
        ), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, name FROM todo_categories WHERE name = %s", (name,)
            )
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute(
                "INSERT INTO todo_categories (name) VALUES (%s)", (name,)
            )
            category_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Category created successfully",
                "category": {"id": category_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO category"}), 500


@todo_bp.route("/todo/category/usage", methods=["GET"])
@jwt_required()
def list_todo_category_usage():
    """
    List every TODO category with the caller's item count and the number of
    items other users have in it.

    Returns:
        200: {"categories": [{"id", "name", "mine", "others"}]}
        404: User not found
        500: Server error
    """
    return _category_usage(category_admin.TODO)


@todo_bp.route("/todo/category/<int:category_id>", methods=["PUT"])
@jwt_required()
def rename_todo_category(category_id):
    """
    Rename a TODO category.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        200: Category renamed (or already had that name)
        400: Validation error
        404: Category or user not found
        409: Name already taken, or other users' items use this category
        500: Server error
    """
    return _category_rename(category_admin.TODO, category_id)


@todo_bp.route("/todo/category/<int:category_id>", methods=["DELETE"])
@jwt_required()
def delete_todo_category(category_id):
    """
    Delete a TODO category, optionally moving the caller's items first.

    Expected JSON:
    {
        "reassign_to": int (optional)
    }

    Returns:
        200: Category deleted
        400: Validation error
        404: Category, replacement, or user not found
        409: Still in use (payload carries "usage")
        500: Server error
    """
    return _category_delete(category_admin.TODO, category_id)


@todo_bp.route("/todo/category/<int:category_id>/merge", methods=["POST"])
@jwt_required()
def merge_todo_category(category_id):
    """
    Merge a TODO category into another. One transaction.

    Expected JSON:
    {
        "into": int
    }

    Returns:
        200: Categories merged
        400: Validation error
        404: Source, target, or user not found
        409: Other users' items use the source category
        500: Server error
    """
    return _category_merge(category_admin.TODO, category_id)


@todo_bp.route("/todo/tags", methods=["GET"])
def list_todo_tags():
    """
    List all TODO tags.

    Returns:
        200: List of tags
        500: Server error
    """
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_tags ORDER BY name")
            tags = cursor.fetchall()

        return jsonify({"tags": tags}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch TODO tags"}), 500


@todo_bp.route("/todo/tag", methods=["POST"])
@jwt_required()
def create_todo_tag():
    """
    Create a new TODO tag if it does not already exist.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        201: Tag created
        200: Tag already exists
        400: Validation error
        500: Server error
    """
    data = request.get_json()

    if not data or "name" not in data:
        return jsonify({"error": "Tag name is required"}), 400

    name = data["name"].strip()

    if not name or len(name) > 50:
        return jsonify(
            {"error": "Tag name must be between 1 and 50 characters"}
        ), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM todo_tags WHERE name = %s", (name,))
            existing = cursor.fetchone()

            if existing:
                return jsonify({"message": "Tag already exists", "tag": existing}), 200

            cursor.execute("INSERT INTO todo_tags (name) VALUES (%s)", (name,))
            tag_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Tag created successfully",
                "tag": {"id": tag_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO tag"}), 500


@todo_bp.route("/todo/create", methods=["POST"])
@jwt_required()
def create_todo_item():
    """
    Create a new TODO item.

    Expected JSON:
    {
        "title": "string",
        "category": "string",
        "description": "string" (optional),
        "priority": "low" | "medium" | "high" (optional, default: "medium"),
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional),
        "recurrence_rule": "none" | "daily" | "weekly" | "monthly" (optional, default: "none"),
        "tags": ["string", ...] (optional)
    }

    Returns:
        201: TODO item created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    required_fields = ["title", "category"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "title and category are required"}
        ), 400

    title = data["title"].strip()
    category_name = data["category"].strip()
    description = data.get("description", "").strip()
    priority = data.get("priority", "medium")
    due_date_str = data.get("due_date")
    recurrence_rule = data.get("recurrence_rule", "none")
    tag_names = data.get("tags", [])

    if not title or len(title) > 255:
        return jsonify(
            {"error": "Title must be between 1 and 255 characters"}
        ), 400

    valid_priorities = ("low", "medium", "high")
    if priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    valid_recurrence_rules = ("none", "daily", "weekly", "monthly")
    if recurrence_rule not in valid_recurrence_rules:
        return jsonify(
            {"error": f"recurrence_rule must be one of: {', '.join(valid_recurrence_rules)}"}
        ), 400

    if not isinstance(tag_names, list):
        return jsonify({"error": "tags must be an array of strings"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                ), 400
            due_date = due_date.astimezone(timezone.utc)
        except ValueError:
            return jsonify({"error": "due_date must be ISO 8601 format with timezone"}), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                "SELECT id FROM todo_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO todo_items
                    (user_id, category_id, title, description, priority, due_date, recurrence_rule)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user["id"],
                    category["id"],
                    title,
                    description,
                    priority,
                    due_date,
                    recurrence_rule,
                ),
            )
            item_id = cursor.lastrowid

            tag_ids = _resolve_or_create_tag_ids(cursor, tag_names)
            _set_todo_item_tags(cursor, item_id, tag_ids)

            created_tags = []
            if tag_ids:
                placeholders = ", ".join(["%s"] * len(tag_ids))
                cursor.execute(
                    f"SELECT id, name FROM todo_tags WHERE id IN ({placeholders}) ORDER BY name",
                    tag_ids,
                )
                created_tags = cursor.fetchall()

        return jsonify(
            {
                "message": "TODO item created successfully",
                "item": {
                    "id": item_id,
                    "title": title,
                    "category": category_name,
                    "description": description,
                    "priority": priority,
                    "due_date": due_date_str,
                    "recurrence_rule": recurrence_rule,
                    "recurrence_parent_id": None,
                    "tags": created_tags,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create TODO item"}), 500


@todo_bp.route("/todo/<int:item_id>", methods=["PUT"])
@jwt_required()
def update_todo_item(item_id):
    """
    Update an existing TODO item.

    Expected JSON:
    {
        "title": "string" (optional),
        "category": "string" (optional),
        "description": "string" (optional),
        "priority": "low" | "medium" | "high" (optional),
        "status": "pending" | "in_progress" | "completed" (optional),
        "due_date": "YYYY-MM-DD HH:MM:SS" (optional),
        "recurrence_rule": "none" | "daily" | "weekly" | "monthly" (optional),
        "tags": ["string", ...] (optional)
    }

    Returns:
        200: TODO item updated
        400: Validation error
        403: Not owner of item
        404: TODO item or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    title = data.get("title", "").strip()
    category_name = data.get("category", "").strip()
    description = data.get("description")
    priority = data.get("priority")
    status = data.get("status")
    due_date_str = data.get("due_date")
    recurrence_rule = data.get("recurrence_rule")
    tag_names = data.get("tags")

    valid_priorities = ("low", "medium", "high")
    if priority and priority not in valid_priorities:
        return jsonify({"error": f"Priority must be one of: {', '.join(valid_priorities)}"}), 400

    valid_statuses = ("pending", "in_progress", "completed")
    if status and status not in valid_statuses:
        return jsonify({"error": f"Status must be one of: {', '.join(valid_statuses)}"}), 400

    valid_recurrence_rules = ("none", "daily", "weekly", "monthly")
    if recurrence_rule and recurrence_rule not in valid_recurrence_rules:
        return jsonify(
            {"error": f"recurrence_rule must be one of: {', '.join(valid_recurrence_rules)}"}
        ), 400

    if tag_names is not None and not isinstance(tag_names, list):
        return jsonify({"error": "tags must be an array of strings"}), 400

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due_date.tzinfo is None:
                return jsonify(
                    {"error": "Timezone information required (ISO 8601 with offset)"}
                ), 400
            due_date = due_date.astimezone(timezone.utc)
        except ValueError:
            return jsonify({"error": "due_date must be ISO 8601 format with timezone"}), 400

    try:
        with app.get_cursor() as cursor:
            # Verify item belongs to this user, and fetch current state for
            # the recurrence-spawn decision below.
            cursor.execute(
                """
                SELECT ti.id, ti.user_id, ti.category_id, ti.title, ti.description,
                       ti.priority, ti.status, ti.due_date, ti.recurrence_rule
                FROM todo_items ti
                JOIN users u ON ti.user_id = u.id
                WHERE ti.id = %s AND u.username = %s
                """,
                (item_id, current_user),
            )
            item = cursor.fetchone()

            if not item:
                return jsonify({"error": "TODO item not found or access denied"}), 404

            previous_status = item["status"]

            # Resolve category if provided
            category_id = None
            if category_name:
                cursor.execute(
                    "SELECT id FROM todo_categories WHERE name = %s", (category_name,)
                )
                category = cursor.fetchone()

                if not category:
                    return jsonify({"error": "Category not found"}), 404
                category_id = category["id"]

            # Build dynamic update query
            updates = []
            values = []
            if title:
                updates.append("title = %s")
                values.append(title)
            if category_id:
                updates.append("category_id = %s")
                values.append(category_id)
            if description is not None:
                updates.append("description = %s")
                values.append(description)
            if priority:
                updates.append("priority = %s")
                values.append(priority)
            if status:
                updates.append("status = %s")
                values.append(status)
                if status == "completed":
                    updates.append("completed_at = %s")
                    values.append(datetime.now(timezone.utc))
                elif status in ("pending", "in_progress"):
                    updates.append("completed_at = %s")
                    values.append(None)
            if due_date is not None:
                updates.append("due_date = %s")
                values.append(due_date)
            if recurrence_rule is not None:
                updates.append("recurrence_rule = %s")
                values.append(recurrence_rule)

            if not updates and tag_names is None:
                return jsonify({"error": "No fields to update"}), 400

            if updates:
                values.append(item_id)
                query = f"UPDATE todo_items SET {', '.join(updates)} WHERE id = %s"
                cursor.execute(query, values)

            if tag_names is not None:
                tag_ids = _resolve_or_create_tag_ids(cursor, tag_names)
                _set_todo_item_tags(cursor, item_id, tag_ids)

            # Spawn the next occurrence only on a genuine pending/in_progress
            # -> completed transition, never on re-completion.
            if status == "completed" and previous_status != "completed":
                effective_rule = (
                    recurrence_rule if recurrence_rule is not None else item["recurrence_rule"]
                )
                effective_due_date = due_date if due_date is not None else item["due_date"]
                _spawn_next_recurrence(
                    cursor,
                    {
                        "id": item_id,
                        "user_id": item["user_id"],
                        "category_id": category_id or item["category_id"],
                        "title": title or item["title"],
                        "description": description if description is not None else item["description"],
                        "priority": priority or item["priority"],
                        "recurrence_rule": effective_rule,
                        "due_date": effective_due_date,
                    },
                )

        return jsonify({"message": "TODO item updated successfully", "id": item_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update TODO item"}), 500


@todo_bp.route("/todo/delete", methods=["POST"])
@jwt_required()
def delete_todo_item():
    """
    Delete a TODO item by item_id.

    Expects JSON:
    {
        "item_id": int
    }

    Returns:
        200: TODO item deleted
        400: Validation error
        403: Not owner of item
        404: TODO item not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "item_id" not in data:
        return jsonify({"error": "item_id is required"}), 400

    item_id = data["item_id"]

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                """
                SELECT ti.id FROM todo_items ti
                JOIN users u ON ti.user_id = u.id
                WHERE ti.id = %s AND u.username = %s
                """,
                (item_id, current_user),
            )
            item = cursor.fetchone()

            if not item:
                return jsonify({"error": "TODO item not found or access denied"}), 404

            cursor.execute("DELETE FROM todo_items WHERE id = %s", (item_id,))

        return jsonify({"message": "TODO item deleted successfully", "id": item_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete TODO item"}), 500


@todo_bp.route("/todo/bulk-update", methods=["POST"])
@jwt_required()
def bulk_update_todo_items():
    """
    Bulk update TODO item statuses.

    Expected JSON:
    {
        "updates": [
            {"item_id": int, "status": "pending" | "in_progress" | "completed"},
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

    if not data or "updates" not in data:
        return jsonify({"error": "updates array is required"}), 400

    updates = data["updates"]
    if not isinstance(updates, list):
        return jsonify({"error": "updates must be an array"}), 400

    results = {"success": 0, "failed": 0, "errors": []}
    valid_statuses = ("pending", "in_progress", "completed")

    for i, update in enumerate(updates):
        try:
            item_id = update.get("item_id")
            status = update.get("status")

            if not item_id or not status:
                raise ValueError("item_id and status are required")

            if status not in valid_statuses:
                raise ValueError(f"Status must be one of: {', '.join(valid_statuses)}")

            with app.get_cursor() as cursor:
                # Verify item belongs to this user
                cursor.execute(
                    """
                    SELECT ti.id, ti.user_id, ti.category_id, ti.title, ti.description,
                           ti.priority, ti.status, ti.due_date, ti.recurrence_rule
                    FROM todo_items ti
                    JOIN users u ON ti.user_id = u.id
                    WHERE ti.id = %s AND u.username = %s
                    """,
                    (item_id, current_user),
                )
                item = cursor.fetchone()

                if not item:
                    raise ValueError("TODO item not found or access denied")

                previous_status = item["status"]
                completed_at = datetime.now(timezone.utc) if status == "completed" else None

                cursor.execute(
                    """
                    UPDATE todo_items
                    SET status = %s, completed_at = %s
                    WHERE id = %s
                    """,
                    (status, completed_at, item_id),
                )

                if status == "completed" and previous_status != "completed":
                    _spawn_next_recurrence(cursor, item)

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to update TODO item {i}: {e}")

    return jsonify(results), 200

