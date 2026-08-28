"""The time namespace's categories, and the namespace-agnostic
rename/delete/merge machinery that finance and todo reuse.

Part of the split described in app.py. Route modules reach shared state through
`import app` rather than `from app import ...`: the name is then resolved when
the view runs, which keeps `patch("app.get_cursor")` working — 42 tests depend
on it — and sidesteps the import cycle, since app.py registers these blueprints
after everything they use exists.
"""

import logging

import mysql.connector
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from mysql.connector import Error

import category_admin

import app

logger = logging.getLogger(__name__)

categories_bp = Blueprint("categories", __name__)


@categories_bp.route("/get/categories", methods=["GET"])
def list_categories():
    """
    List all categories.

    Returns:
        200: List of categories
        500: Server error
    """
    try:
        with app.get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM category ORDER BY name")
            categories = cursor.fetchall()

        return jsonify({"categories": categories}), 200

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to fetch categories"}), 500


@categories_bp.route("/category", methods=["POST"])
@jwt_required()
def create_category():
    """
    Create a new category if it does not already exist.

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
            cursor.execute("SELECT id, name FROM category WHERE name = %s", (name,))
            existing = cursor.fetchone()

            if existing:
                return jsonify(
                    {"message": "Category already exists", "category": existing}
                ), 200

            cursor.execute("INSERT INTO category (name) VALUES (%s)", (name,))
            category_id = cursor.lastrowid

        return jsonify(
            {
                "message": "Category created successfully",
                "category": {"id": category_id, "name": name},
            }
        ), 201

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to create category"}), 500


# ─── Category Administration ──────────────────────────────────────────────────
#
# Rename / delete / merge for all three category namespaces. The per-namespace
# logic lives in category_admin.py; these routes only unpack the request and
# hand it a cursor, so the whole operation runs in one transaction.


def _resolve_user_id(cursor, username):
    cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
    row = cursor.fetchone()
    return row["id"] if row else None


def _run_category_admin(namespace, operation):
    """Open one transaction, resolve the caller, and run `operation` in it.

    `operation(cursor, namespace, user_id)` returns `(payload, status)`. Every
    failure path in category_admin returns before it writes anything, so a 4xx
    leaves the transaction empty; a raised error rolls it back via app.get_cursor().
    """
    try:
        with app.get_cursor() as cursor:
            user_id = _resolve_user_id(cursor, get_jwt_identity())
            if user_id is None:
                return jsonify({"error": "User not found"}), 404

            payload, status = operation(cursor, namespace, user_id)

        return jsonify(payload), status

    except mysql.connector.IntegrityError as e:
        # A concurrent write slipped an entry in under a category being
        # deleted (RESTRICT), or claimed the name being renamed to (UNIQUE).
        logger.error(f"Category constraint violation: {e}")
        return jsonify(
            {"error": "That category is in use or the name is already taken"}
        ), 409

    except Error as e:
        logger.error(f"Database error: {e}")
        return jsonify({"error": "Failed to update category"}), 500


def _category_usage(namespace):
    return _run_category_admin(
        namespace,
        lambda cursor, ns, user_id: (
            {"categories": category_admin.list_with_usage(cursor, ns, user_id)},
            200,
        ),
    )


def _category_rename(namespace, category_id):
    data = request.get_json(silent=True) or {}

    if "name" not in data:
        return jsonify({"error": "Category name is required"}), 400

    name = data["name"]
    return _run_category_admin(
        namespace,
        lambda cursor, ns, user_id: category_admin.rename(
            cursor, ns, category_id, name, user_id
        ),
    )


def _category_delete(namespace, category_id):
    data = request.get_json(silent=True) or {}
    # Accepted in the body or as a query arg, since not every client will send
    # a body on DELETE.
    raw = data.get("reassign_to", request.args.get("reassign_to"))
    reassign_to = category_admin.coerce_id(raw)

    if raw is not None and reassign_to is None:
        return jsonify({"error": "reassign_to must be a category id"}), 400

    return _run_category_admin(
        namespace,
        lambda cursor, ns, user_id: category_admin.delete(
            cursor, ns, category_id, reassign_to, user_id
        ),
    )


def _category_merge(namespace, source_id):
    data = request.get_json(silent=True) or {}
    target_id = category_admin.coerce_id(data.get("into"))

    if target_id is None:
        return jsonify({"error": "A target category id ('into') is required"}), 400

    return _run_category_admin(
        namespace,
        lambda cursor, ns, user_id: category_admin.merge(
            cursor, ns, source_id, target_id, user_id
        ),
    )


@categories_bp.route("/category/usage", methods=["GET"])
@jwt_required()
def list_category_usage():
    """
    List every time category with the caller's entry count and the number of
    entries other users have in it, so the UI can show what a delete affects.

    Returns:
        200: {"categories": [{"id", "name", "mine", "others"}]}
        404: User not found
        500: Server error
    """
    return _category_usage(category_admin.TIME)


@categories_bp.route("/category/<int:category_id>", methods=["PUT"])
@jwt_required()
def rename_category(category_id):
    """
    Rename a time category.

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
    return _category_rename(category_admin.TIME, category_id)


@categories_bp.route("/category/<int:category_id>", methods=["DELETE"])
@jwt_required()
def delete_category(category_id):
    """
    Delete a time category.

    time_entries.category_id is ON DELETE RESTRICT, so a category still in use
    is refused with the blocking count unless a replacement is named:

    {
        "reassign_to": int (optional) — move the caller's entries here first
    }

    Returns:
        200: Category deleted
        400: Validation error
        404: Category, replacement, or user not found
        409: Still in use (payload carries "usage")
        500: Server error
    """
    return _category_delete(category_admin.TIME, category_id)


@categories_bp.route("/category/<int:category_id>/merge", methods=["POST"])
@jwt_required()
def merge_category(category_id):
    """
    Merge a time category into another: move the caller's entries across, then
    drop the source. One transaction.

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
    return _category_merge(category_admin.TIME, category_id)


