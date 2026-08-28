"""Finance entries, their categories, the bulk generator and PDF import.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

import calendar
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

import category_admin
import finance_due
from categories import normalize_category_name
from itau_pdf import (
    ItauPdfError,
    extract_statement_from_bytes,
    statement_to_finance_entries,
)
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

finance_bp = Blueprint("finance", __name__)


FINANCE_SORTABLE = {
    "purchase_date": "fe.purchase_date",
    "price": "fe.price",
    "product_name": "fe.product_name",
    "category": "fc.name",
    "status": "fe.status",
}

FINANCE_DEFAULT_ORDER = "fe.purchase_date DESC"


def retrieve_finance_entries_from_username(username, query=None):
    query = query or ListQuery()
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            # A planned entry whose date has arrived is spent money, and this is
            # the one read path every finance screen goes through. Same cursor,
            # so it commits with the SELECT below and cannot be half-applied to
            # the rows we are about to return. The daily sweep in finance_due
            # covers users who are not currently looking.
            finance_due.complete_due_planned_entries(cursor, user["id"])

            where, filter_params = build_filters(
                query,
                date_column="fe.purchase_date",
                category_column="fc.name",
                search_columns=("fe.product_name", "fc.name"),
            )
            order = build_order(
                query, FINANCE_SORTABLE, FINANCE_DEFAULT_ORDER, "fe.id"
            )
            page, page_params = build_page(query)

            cursor.execute(
                f"""
                SELECT
                    fe.id,
                    fc.name AS category,
                    fe.product_name,
                    fe.price,
                    fe.purchase_date,
                    fe.status
                FROM finance_entries fe
                JOIN finance_categories fc ON fe.category_id = fc.id
                WHERE fe.user_id = %s{where}
                {order}
                {page}
                """,
                tuple([user["id"], *filter_params, *page_params]),
            )
            entries = cursor.fetchall()

            # Convert Decimal to float for JSON serialization
            for entry in entries:
                if entry["price"] is not None:
                    entry["price"] = float(entry["price"])

            body = {"username": username, "entries": entries}

            if query.paginated:
                cursor.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM finance_entries fe
                    JOIN finance_categories fc ON fe.category_id = fc.id
                    WHERE fe.user_id = %s{where}
                    """,
                    tuple([user["id"], *filter_params]),
                )
                body["page"] = page_meta(query, cursor.fetchone()["total"])

        return jsonify(body), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch finance entries"}), 500


@finance_bp.get("/finance")
@jwt_required()
def my_finance_entries():
    """
    Retrieves finance entries from a user from token username.

    Optional query parameters (see query_params.py):
        from, to       ISO date or datetime bounds on purchase_date
        category       exact category name
        q              substring of the product name or the category name
        sort           purchase_date | price | product_name | category | status
        direction      asc | desc
        limit, offset  window; a windowed response also carries a "page" block

    With none of them the response is exactly what it has always been.
    """
    username = get_jwt_identity()
    if not username:
        return jsonify({"error": "Username is required"}), 400

    try:
        query = parse_list_query(request.args, FINANCE_SORTABLE)
    except QueryParamError as e:
        return jsonify({"error": str(e)}), 400

    return retrieve_finance_entries_from_username(username, query)


@finance_bp.route("/finance/categories", methods=["GET"])
def list_finance_categories():
    """
    List all finance categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch finance categories"}), 500


@finance_bp.route("/finance/category", methods=["POST"])
@jwt_required()
def create_finance_category():
    """
    Create a new finance category if it does not already exist.

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

    name = normalize_category_name(data["name"].strip())

    if not name or len(name) > 100:
        return jsonify(
            {"error": "Category name must be between 1 and 100 characters"}
        ), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id, name FROM finance_categories WHERE name = %s", (name,)
            )
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute(
                "INSERT INTO finance_categories (name) VALUES (%s)", (name,)
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
        return jsonify({"error": "Failed to create finance category"}), 500


@finance_bp.route("/finance/category/usage", methods=["GET"])
@jwt_required()
def list_finance_category_usage():
    """
    List every finance category with the caller's entry count and the number of
    entries other users have in it.

    Returns:
        200: {"categories": [{"id", "name", "mine", "others"}]}
        404: User not found
        500: Server error
    """
    return _category_usage(category_admin.FINANCE)


@finance_bp.route("/finance/category/<int:category_id>", methods=["PUT"])
@jwt_required()
def rename_finance_category(category_id):
    """
    Rename a finance category. The new name is normalized the same way a
    created one is, so a rename cannot reintroduce a shouted name.

    Expected JSON:
    {
        "name": "string"
    }

    Returns:
        200: Category renamed (or already had that name)
        400: Validation error
        404: Category or user not found
        409: Name already taken, or other users' entries use this category
        500: Server error
    """
    return _category_rename(category_admin.FINANCE, category_id)


@finance_bp.route("/finance/category/<int:category_id>", methods=["DELETE"])
@jwt_required()
def delete_finance_category(category_id):
    """
    Delete a finance category, optionally moving the caller's entries first.

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
    return _category_delete(category_admin.FINANCE, category_id)


@finance_bp.route("/finance/category/<int:category_id>/merge", methods=["POST"])
@jwt_required()
def merge_finance_category(category_id):
    """
    Merge a finance category into another. One transaction.

    Expected JSON:
    {
        "into": int
    }

    Returns:
        200: Categories merged
        400: Validation error
        404: Source, target, or user not found
        409: Other users' entries use the source category
        500: Server error
    """
    return _category_merge(category_admin.FINANCE, category_id)


@finance_bp.route("/finance/create", methods=["POST"])
@jwt_required()
def create_finance_entry():
    """
    Create a new finance entry.

    Expected JSON:
    {
        "product_name": "string",
        "category": "string",
        "price": number,
        "purchase_date": "YYYY-MM-DD HH:MM:SS",
        "status": "planned" | "done" (optional, defaults to "planned")
    }

    Returns:
        201: Entry created
        400: Validation error
        404: User or category not found
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    required_fields = ["product_name", "category", "price", "purchase_date"]
    if not data or not all(field in data for field in required_fields):
        return jsonify(
            {"error": "product_name, category, price and purchase_date are required"}
        ), 400

    product_name = data["product_name"].strip()
    category_name = data["category"].strip()
    price = data["price"]
    purchase_date_str = data["purchase_date"]
    status = data.get("status", "planned")

    if not product_name or len(product_name) > 255:
        return jsonify(
            {"error": "Product name must be between 1 and 255 characters"}
        ), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "Status must be 'planned' or 'done'"}), 400

    try:
        price_value = float(price)
        if price_value < 0:
            return jsonify({"error": "Price must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Price must be a valid number"}), 400

    try:
        purchase_date = datetime.fromisoformat(
            purchase_date_str.replace("Z", "+00:00")
        )
        if purchase_date.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400
        purchase_date = purchase_date.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM users WHERE username = %s", (current_user,)
            )
            user = cursor.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            cursor.execute(
                "SELECT id FROM finance_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user["id"], category["id"], product_name, price_value, purchase_date, status),
            )
            entry_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Finance entry created successfully",
                "entry": {
                    "id": entry_id,
                    "product_name": product_name,
                    "category": category_name,
                    "price": price_value,
                    "purchase_date": purchase_date_str,
                    "status": status,
                },
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create finance entry"}), 500


@finance_bp.route("/finance/<int:entry_id>", methods=["PUT"])
@jwt_required()
def update_finance_entry(entry_id):
    """
    Update an existing finance entry.

    Expected JSON:
    {
        "product_name": "string",
        "category": "string",
        "price": number,
        "purchase_date": "YYYY-MM-DD HH:MM:SS",
        "status": "planned" | "done"
    }

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

    product_name = data.get("product_name", "").strip()
    category_name = data.get("category", "").strip()
    price = data.get("price")
    purchase_date_str = data.get("purchase_date")
    status = data.get("status", "planned")

    if not product_name or not category_name or not purchase_date_str:
        return jsonify(
            {"error": "product_name, category and purchase_date are required"}
        ), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "Status must be 'planned' or 'done'"}), 400

    try:
        price_value = float(price) if price is not None else None
        if price_value is not None and price_value < 0:
            return jsonify({"error": "Price must be non-negative"}), 400
    except (TypeError, ValueError):
        return jsonify({"error": "Price must be a valid number"}), 400

    try:
        purchase_date = datetime.fromisoformat(
            purchase_date_str.replace("Z", "+00:00")
        )
        if purchase_date.tzinfo is None:
            return jsonify(
                {"error": "Timezone information required (ISO 8601 with offset)"}
            ), 400
        purchase_date = purchase_date.astimezone(timezone.utc)
    except ValueError:
        return jsonify({"error": "Datetime must be ISO 8601 format with timezone"}), 400

    try:
        with app.get_cursor() as cursor:
            # Verify entry belongs to this user
            cursor.execute(
                """
                SELECT fe.id FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE fe.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            # Resolve category
            cursor.execute(
                "SELECT id FROM finance_categories WHERE name = %s", (category_name,)
            )
            category = cursor.fetchone()

            if not category:
                return jsonify({"error": "Category not found"}), 404

            cursor.execute(
                """
                UPDATE finance_entries
                SET category_id = %s, product_name = %s, price = %s, purchase_date = %s, status = %s
                WHERE id = %s
                """,
                (category["id"], product_name, price_value, purchase_date, status, entry_id),
            )

        return jsonify({"message": "Finance entry updated successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update finance entry"}), 500


@finance_bp.route("/finance/delete", methods=["POST"])
@jwt_required()
def delete_finance_entry():
    """
    Delete a finance entry by entry_id.

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
                SELECT fe.id FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE fe.id = %s AND u.username = %s
                """,
                (entry_id, current_user),
            )
            entry = cursor.fetchone()

            if not entry:
                return jsonify({"error": "Entry not found or access denied"}), 404

            cursor.execute("DELETE FROM finance_entries WHERE id = %s", (entry_id,))

        return jsonify({"message": "Finance entry deleted successfully", "id": entry_id}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete finance entry"}), 500


@finance_bp.route("/finance/bulk-delete", methods=["POST"])
@jwt_required()
def bulk_delete_finance_entries():
    """
    Delete several finance entries in one request.

    Expects JSON:
    {
        "entry_ids": [int, ...]
    }

    Ownership is enforced inside the DELETE itself, so ids belonging to another
    user are simply not matched. The response reports how many rows actually
    went, without revealing which of the others exist.

    Returns:
        200: { deleted: int, requested: int }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data or "entry_ids" not in data:
        return jsonify({"error": "entry_ids is required"}), 400

    entry_ids = data["entry_ids"]

    if not isinstance(entry_ids, list) or not entry_ids:
        return jsonify({"error": "entry_ids must be a non-empty array"}), 400

    if len(entry_ids) > app.MAX_BULK_DELETE_IDS:
        return jsonify({
            "error": f"Too many entries (max {app.MAX_BULK_DELETE_IDS} at a time)"
        }), 400

    try:
        ids = [int(entry_id) for entry_id in entry_ids]
    except (TypeError, ValueError):
        return jsonify({"error": "entry_ids must all be integers"}), 400

    placeholders = ", ".join(["%s"] * len(ids))

    try:
        with app.get_cursor() as cursor:
            cursor.execute(
                f"""
                DELETE fe FROM finance_entries fe
                JOIN users u ON fe.user_id = u.id
                WHERE u.username = %s AND fe.id IN ({placeholders})
                """,
                (current_user, *ids),
            )
            deleted = cursor.rowcount

        return jsonify({"deleted": deleted, "requested": len(ids)}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to delete finance entries"}), 500


@finance_bp.route("/finance/batch-import", methods=["POST"])
@jwt_required()
def batch_import_finance_entries():
    """
    Batch import multiple finance entries from a single request.

    Expected JSON:
    {
        "entries": [
            {
                "category": "string",
                "product_name": "string",
                "price": number,
                "purchase_date": "YYYY-MM-DD HH:MM:SS",
                "status": "planned" | "done" (optional, defaults to "planned")
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

    # First, get or create all finance categories. The cache is keyed by
    # casefolded name because finance_categories.name is uniquely indexed with
    # a case-insensitive collation — looking up case-sensitively would miss an
    # existing "Food" for an incoming "FOOD" and then fail on a duplicate key.
    category_cache = {}
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"].casefold()] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    # Get user ID once
    user_id = None
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
            if user:
                user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    if not user_id:
        return jsonify({"error": "User not found"}), 404

    for i, entry in enumerate(entries):
        try:
            category_name = entry.get("category", "").strip()
            product_name = entry.get("product_name", "").strip()
            price = entry.get("price")
            purchase_date_str = entry.get("purchase_date")
            status = entry.get("status", "planned")

            if not category_name or not product_name or not purchase_date_str:
                raise ValueError("category, product_name and purchase_date are required")

            # Validate price
            price_value = float(price)
            if price_value < 0:
                raise ValueError("Price must be non-negative")

            # Validate status
            if status not in ("planned", "done"):
                raise ValueError("Status must be 'planned' or 'done'")

            # Parse and validate date
            purchase_date = datetime.fromisoformat(purchase_date_str.replace("Z", "+00:00"))
            if purchase_date.tzinfo is None:
                raise ValueError("Timezone information required")
            purchase_date = purchase_date.astimezone(timezone.utc)

            # Get or create category. A name that is not on record yet is
            # normalized first, so an imported "ALIMENTAÇÃO" is stored as
            # "Alimentação"; one that already exists keeps its stored spelling.
            category_key = category_name.casefold()
            if category_key not in category_cache:
                with app.get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (normalize_category_name(category_name),)
                    )
                    category_cache[category_key] = cursor.lastrowid

            category_id = category_cache[category_key]

            # Insert finance entry
            with app.get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, product_name, price_value, purchase_date, status)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to import finance entry {i}: {e}")

    return jsonify(results), 200


# ─── Finance Bulk Generator ────────────────────────────────────────────────────


def _last_day_of_month(year, month):
    """Return the number of days in a given month (28/29 for February)."""
    return calendar.monthrange(year, month)[1]


def _clamped_generation_day(year, month, day):
    """Resolve a requested day-of-month to an actual day, clamping to the last
    day of the month when it is shorter (e.g. day 31 in April -> 30). A day of
    -1 explicitly means the last day of the month."""
    if day == -1:
        return _last_day_of_month(year, month)
    return min(day, _last_day_of_month(year, month))


def _generate_occurrence_dates(frequency, day, start_date, end_date):
    """Compute the occurrence dates in [start_date, end_date] for a day-of-month
    frequency (monthly / quarterly / yearly), anchored on the start date's
    month. Occurrences whose date falls outside the window are dropped."""
    step = {"monthly": 1, "quarterly": 3, "yearly": 12}[frequency]
    anchor = start_date.year * 12 + (start_date.month - 1)
    dates = []
    cursor = anchor
    while True:
        year, month = divmod(cursor, 12)
        month += 1
        occurrence = date(year, month, _clamped_generation_day(year, month, day))
        if occurrence > end_date:
            break
        if occurrence >= start_date:
            dates.append(occurrence)
        cursor += step
    return dates


@finance_bp.route("/finance/batch-generate", methods=["POST"])
@jwt_required()
def batch_generate_finance_entries():
    """
    Generate finance entries from a schedule: a frequency plus a day-of-month,
    applied across a date range to every entry template in one go.

    Expected JSON:
    {
        "frequency": "monthly" | "quarterly" | "yearly",
        "day": int,                 # 1-31, or -1 for the last day of the month
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD",
        "status": "planned" | "done" (optional, defaults to "planned"),
        "entries": [
            { "category": "string", "product_name": "string", "price": number },
            ...
        ],
        "preview": bool (optional, defaults to false),
        "utc_offset_minutes": int (optional, defaults to 0)
    }

    `utc_offset_minutes` is the client's current UTC offset (new
    Date().getTimezoneOffset()) so the stored timestamp keeps each entry on the
    picked day when displayed back in the same timezone.

    With preview=true no rows are written; the response contains every row that
    would be created. Otherwise the rows are inserted and per-row errors are
    collected like /finance/batch-import.

    Returns:
        200: { preview, count, rows } or { success, failed, errors }
        400: Validation error
        500: Server error
    """
    current_user = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "Request body is required"}), 400

    frequency = data.get("frequency")
    day = data.get("day")
    start_date_str = data.get("start_date")
    end_date_str = data.get("end_date")
    status = data.get("status", "planned")
    entries = data.get("entries")
    preview = bool(data.get("preview", False))
    utc_offset_minutes = data.get("utc_offset_minutes", 0)

    valid_frequencies = ("monthly", "quarterly", "yearly")
    if frequency not in valid_frequencies:
        return jsonify(
            {"error": f"frequency must be one of: {', '.join(valid_frequencies)}"}
        ), 400

    try:
        day_value = int(day)
        if day_value == -1:
            pass
        elif not 1 <= day_value <= 31:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "day must be an integer between 1 and 31, or -1 for the last day of the month"}), 400

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return jsonify({"error": "start_date and end_date must be in YYYY-MM-DD format"}), 400

    if end_date < start_date:
        return jsonify({"error": "end_date must be on or after start_date"}), 400

    if status not in ("planned", "done"):
        return jsonify({"error": "status must be 'planned' or 'done'"}), 400

    if not isinstance(entries, list) or not entries:
        return jsonify({"error": "entries must be a non-empty array"}), 400

    normalized_entries = []
    for entry in entries:
        category_name = entry.get("category", "").strip()
        product_name = entry.get("product_name", "").strip()
        if not category_name or not product_name:
            return jsonify({"error": "each entry needs a category and a product_name"}), 400
        try:
            price_value = float(entry.get("price"))
            if price_value < 0:
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": f"price for '{product_name}' must be a non-negative number"}), 400
        normalized_entries.append((category_name, product_name, price_value))

    occurrence_dates = _generate_occurrence_dates(
        frequency, day_value, start_date, end_date
    )
    if not occurrence_dates:
        return jsonify(
            {"error": "No occurrences fall inside the selected date range"}
        ), 400

    try:
        utc_offset = int(utc_offset_minutes)
    except (TypeError, ValueError):
        return jsonify({"error": "utc_offset_minutes must be an integer"}), 400

    generated_rows = []
    for occurrence in occurrence_dates:
        purchase_date = datetime.combine(
            occurrence, datetime.min.time()
        ) + timedelta(minutes=utc_offset)
        for category_name, product_name, price_value in normalized_entries:
            generated_rows.append({
                "category": category_name,
                "product_name": product_name,
                "price": price_value,
                "purchase_date": purchase_date,
            })

    if len(generated_rows) > app.MAX_GENERATE_ROWS:
        return jsonify({
            "error": f"This schedule would create {len(generated_rows)} entries (max {app.MAX_GENERATE_ROWS})"
        }), 400

    if preview:
        return jsonify({
            "preview": True,
            "count": len(generated_rows),
            "rows": [
                {
                    "category": row["category"],
                    "product_name": row["product_name"],
                    "price": row["price"],
                    "purchase_date": row["purchase_date"].isoformat(),
                }
                for row in generated_rows
            ],
        }), 200

    # Get or create all finance categories. The cache is keyed by casefolded
    # name because finance_categories.name is uniquely indexed with a
    # case-insensitive collation (see /finance/batch-import).
    category_cache = {}
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            existing_categories = cursor.fetchall()
            for cat in existing_categories:
                category_cache[cat["name"].casefold()] = cat["id"]
    except Error as e:
        logger.error(f"Database error fetching categories: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500

    user_id = None
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", (current_user,))
            user = cursor.fetchone()
            if user:
                user_id = user["id"]
    except Error as e:
        logger.error(f"Database error fetching user: {e}")
        return jsonify({"error": "Failed to fetch user"}), 500

    if not user_id:
        return jsonify({"error": "User not found"}), 404

    results = {"success": 0, "failed": 0, "errors": []}

    for i, row in enumerate(generated_rows):
        try:
            category_key = row["category"].casefold()
            if category_key not in category_cache:
                with app.get_cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO finance_categories (name) VALUES (%s)",
                        (normalize_category_name(row["category"]),)
                    )
                    category_cache[category_key] = cursor.lastrowid

            category_id = category_cache[category_key]

            with app.get_cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO finance_entries (user_id, category_id, product_name, price, purchase_date, status)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, category_id, row["product_name"], row["price"], row["purchase_date"], status)
                )

            results["success"] += 1

        except Exception as e:
            results["failed"] += 1
            results["errors"].append({"index": i, "error": str(e)})
            logger.error(f"Failed to generate finance entry {i}: {e}")

    return jsonify(results), 200


@finance_bp.route("/finance/parse-itau-pdf", methods=["POST"])
@jwt_required()
def parse_itau_pdf():
    """
    Parse one or more uploaded Itau credit card statement PDFs into finance
    entries.

    This endpoint only reads the PDFs — nothing is written to the database. The
    client previews the result and then posts the entries it wants to
    /finance/batch-import, which is where the actual insert happens.

    Each file is parsed independently so that one unreadable PDF does not sink
    the rest of the batch; its failure is reported in `failures` instead.

    Expected: multipart/form-data with one or more "file" fields holding PDFs.

    Returns:
        200: {
            statements: [{ file, issued_on, due_on, cards, total, reconciled,
                           entry_count, skipped_count }],
            failures: [{ file, error }],
            entries: [{ category, product_name, price, purchase_date, status,
                        card, file }],
            skipped: [{ ..., reason }]
        }
        400: No files at all, or too many files
        500: Server error
    """
    uploads = [f for f in request.files.getlist("file") if f and f.filename]
    if not uploads:
        return jsonify({"error": "At least one PDF file is required"}), 400

    if len(uploads) > app.MAX_PDF_UPLOAD_COUNT:
        return jsonify({
            "error": f"Too many files (max {app.MAX_PDF_UPLOAD_COUNT} at a time)"
        }), 400

    statements = []
    failures = []
    all_entries = []
    all_skipped = []
    # An Itau statement is uniquely identified by its issue date, so the same
    # statement downloaded twice under different filenames is caught here
    # rather than silently importing every transaction on it twice.
    seen_issue_dates = {}

    for uploaded in uploads:
        filename = uploaded.filename
        try:
            pdf_bytes = uploaded.read()
            if len(pdf_bytes) > app.MAX_PDF_UPLOAD_BYTES:
                raise ItauPdfError("PDF is too large (max 10 MB)")

            statement = extract_statement_from_bytes(pdf_bytes, filename)
        except ItauPdfError as e:
            failures.append({"file": filename, "error": str(e)})
            continue
        except Exception as e:
            logger.error(f"Failed to parse Itau PDF {filename}: {e}")
            failures.append({"file": filename, "error": "Failed to parse the PDF"})
            continue

        issued_on = statement["emissao"]
        if issued_on in seen_issue_dates:
            failures.append({
                "file": filename,
                "error": (
                    f"Same statement as {seen_issue_dates[issued_on]} "
                    f"(both issued {issued_on}) — skipped to avoid duplicates"
                ),
            })
            continue
        seen_issue_dates[issued_on] = filename

        entries, skipped = statement_to_finance_entries(statement)
        for row in entries:
            row["file"] = filename
        for row in skipped:
            row["file"] = filename

        all_entries.extend(entries)
        all_skipped.extend(skipped)
        statements.append({
            "file": filename,
            "issued_on": issued_on,
            "due_on": statement["vencimento"],
            "cards": sorted(statement["titulares"].keys()),
            "total": statement["resumo"]["total_lancamentos"],
            # False means the transactions we read do not add up to the totals
            # printed on the statement, i.e. the parse likely missed something.
            "reconciled": statement["resumo"]["conferido"],
            "entry_count": len(entries),
            "skipped_count": len(skipped),
        })

    statements.sort(key=lambda s: s["issued_on"])
    all_entries.sort(key=lambda e: e["purchase_date"])
    all_skipped.sort(key=lambda e: e["purchase_date"])

    return jsonify({
        "statements": statements,
        "failures": failures,
        "entries": all_entries,
        "skipped": all_skipped,
    }), 200

