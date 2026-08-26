"""Rename, delete, and merge for the three category namespaces.

Time, finance, and TODO each keep their own lookup table, and until now all
three were create-only: a typo'd category was permanent. The three namespaces
differ in nothing but table names and whether names are normalized on write, so
the logic lives here once and app.py wires three thin route trios onto it.

Ownership
---------
The lookup tables are global — no `user_id` column, and names are UNIQUE across
every user. Renaming or deleting a row therefore changes what *everyone* sees,
so every operation here first counts how many entries reference the category and
who owns them:

* rows owned by other users  -> the operation is refused (409). This is the
  ownership guard: a user can never rename away, delete, or relocate a category
  another user's entries depend on.
* rows owned by the caller   -> see below.
* no rows at all             -> free to rename or delete.

The RESTRICT foreign key
------------------------
`time_entries`, `finance_entries`, and `todo_items` all reference their category
with `ON DELETE RESTRICT`, so a delete can neither cascade nor orphan rows. The
choice made here is **refuse-by-default with an escape hatch**:

* `delete(..., reassign_to=None)` on a category still in use returns 409 and the
  count of entries blocking it, so the UI can say exactly what is in the way.
* `delete(..., reassign_to=<other id>)` moves those entries first and then drops
  the category. Both statements run on the caller's cursor, i.e. inside the one
  transaction `get_cursor()` opens, so a failure anywhere rolls the move back
  rather than leaving entries re-pointed at a category that never went away.

`merge()` is the same move, with the reassignment mandatory and the counts
reported as a merge rather than a delete.

Cursors are passed in rather than opened here so this module does not import
back into app.py — the same arrangement migrations.py uses.
"""

from collections import namedtuple

from categories import normalize_category_name

MAX_NAME_LENGTH = 100

# Table names are interpolated into the SQL below because MySQL will not take
# an identifier as a placeholder. They are never user input: the only values
# that ever reach these fields are the three literals defined right here.
CategoryNamespace = namedtuple(
    "CategoryNamespace", ["key", "table", "entry_table", "label", "normalize"]
)

TIME = CategoryNamespace(
    key="time",
    table="category",
    entry_table="time_entries",
    label="Category",
    normalize=False,
)

FINANCE = CategoryNamespace(
    key="finance",
    table="finance_categories",
    entry_table="finance_entries",
    label="Finance category",
    normalize=True,
)

TODO = CategoryNamespace(
    key="todo",
    table="todo_categories",
    entry_table="todo_items",
    label="TODO category",
    normalize=False,
)

NAMESPACES = {ns.key: ns for ns in (TIME, FINANCE, TODO)}


# ─── Internals ────────────────────────────────────────────────────────────────


def clean_name(namespace, raw):
    """Trim, and normalize where the namespace asks for it (finance names come
    from shouted statement PDFs). Returns "" for anything unusable."""
    if not isinstance(raw, str):
        return ""
    name = raw.strip()
    if namespace.normalize:
        name = normalize_category_name(name)
    return name


def coerce_id(value):
    """A category id from a JSON body, or None when it is not one."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _load(cursor, namespace, category_id):
    cursor.execute(
        f"SELECT id, name FROM {namespace.table} WHERE id = %s", (category_id,)
    )
    return cursor.fetchone()


def _usage(cursor, namespace, category_id, user_id):
    """(entries owned by this user, entries owned by anyone else)."""
    cursor.execute(
        f"""
        SELECT
            COALESCE(SUM(user_id = %s), 0)  AS mine,
            COALESCE(SUM(user_id <> %s), 0) AS others
        FROM {namespace.entry_table}
        WHERE category_id = %s
        """,
        (user_id, user_id, category_id),
    )
    row = cursor.fetchone()
    return int(row["mine"]), int(row["others"])


def _shared_error(namespace, category, others):
    """The 409 returned when someone else's entries are in the way."""
    return {
        "error": (
            f'"{category["name"]}" is shared: {others} '
            f"{'entry' if others == 1 else 'entries'} belonging to other users "
            f"use it, so it cannot be renamed, deleted, or merged."
        ),
        "usage": {"others": others},
    }, 409


def _move_entries(cursor, namespace, source_id, target_id, user_id):
    """Re-point the caller's entries from one category to another.

    Scoped to `user_id` even though the callers have already established that
    nobody else's entries reference the source — defense in depth, so a bug in
    a guard can never move data the caller does not own.
    """
    cursor.execute(
        f"""
        UPDATE {namespace.entry_table}
        SET category_id = %s
        WHERE category_id = %s AND user_id = %s
        """,
        (target_id, source_id, user_id),
    )
    return cursor.rowcount


# ─── Operations ───────────────────────────────────────────────────────────────


def list_with_usage(cursor, namespace, user_id):
    """Every category in the namespace with the caller's and other users' entry
    counts, so a management UI can show what a delete would affect."""
    cursor.execute(
        f"""
        SELECT c.id, c.name,
               COALESCE(SUM(e.user_id = %s), 0)  AS mine,
               COALESCE(SUM(e.user_id <> %s), 0) AS others
        FROM {namespace.table} c
        LEFT JOIN {namespace.entry_table} e ON e.category_id = c.id
        GROUP BY c.id, c.name
        ORDER BY c.name
        """,
        (user_id, user_id),
    )
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "mine": int(row["mine"]),
            "others": int(row["others"]),
        }
        for row in cursor.fetchall()
    ]


def rename(cursor, namespace, category_id, raw_name, user_id):
    """Rename a category. (payload, status)."""
    category = _load(cursor, namespace, category_id)
    if not category:
        return {"error": f"{namespace.label} not found"}, 404

    name = clean_name(namespace, raw_name)
    if not name or len(name) > MAX_NAME_LENGTH:
        return {
            "error": (
                f"Category name must be between 1 and {MAX_NAME_LENGTH} characters"
            )
        }, 400

    _, others = _usage(cursor, namespace, category_id, user_id)
    if others:
        return _shared_error(namespace, category, others)

    if name == category["name"]:
        return {
            "message": "Category unchanged",
            "category": {"id": category_id, "name": name},
        }, 200

    # Names are UNIQUE per table. Checking first turns what would otherwise
    # surface as a 500 from the constraint into a 409 the UI can explain.
    cursor.execute(
        f"SELECT id FROM {namespace.table} WHERE name = %s AND id <> %s",
        (name, category_id),
    )
    if cursor.fetchone():
        return {
            "error": (
                f'A category named "{name}" already exists. '
                f"Merge into it instead of renaming."
            )
        }, 409

    cursor.execute(
        f"UPDATE {namespace.table} SET name = %s WHERE id = %s", (name, category_id)
    )

    return {
        "message": "Category renamed successfully",
        "category": {"id": category_id, "name": name},
        "previous_name": category["name"],
    }, 200


def delete(cursor, namespace, category_id, reassign_to, user_id):
    """Delete a category, optionally moving the caller's entries to
    `reassign_to` first. See the module docstring on the RESTRICT FK."""
    category = _load(cursor, namespace, category_id)
    if not category:
        return {"error": f"{namespace.label} not found"}, 404

    mine, others = _usage(cursor, namespace, category_id, user_id)
    if others:
        return _shared_error(namespace, category, others)

    if mine and reassign_to is None:
        return {
            "error": (
                f'"{category["name"]}" is still used by {mine} of your '
                f"{'entry' if mine == 1 else 'entries'}. Choose a category to "
                f"move them to, or delete them first."
            ),
            "usage": {"mine": mine, "others": 0},
        }, 409

    moved = 0
    if reassign_to is not None:
        if reassign_to == category_id:
            return {"error": "Cannot reassign a category to itself"}, 400

        target = _load(cursor, namespace, reassign_to)
        if not target:
            return {"error": "Replacement category not found"}, 404

        moved = _move_entries(cursor, namespace, category_id, reassign_to, user_id)

    cursor.execute(f"DELETE FROM {namespace.table} WHERE id = %s", (category_id,))

    return {
        "message": "Category deleted successfully",
        "id": category_id,
        "name": category["name"],
        "reassigned": moved,
    }, 200


def merge(cursor, namespace, source_id, target_id, user_id):
    """Move the caller's entries from `source_id` to `target_id`, then drop the
    source. One transaction — the cursor's."""
    if target_id is None:
        return {"error": "A target category id ('into') is required"}, 400

    if target_id == source_id:
        return {"error": "Cannot merge a category into itself"}, 400

    source = _load(cursor, namespace, source_id)
    if not source:
        return {"error": f"{namespace.label} not found"}, 404

    target = _load(cursor, namespace, target_id)
    if not target:
        return {"error": "Target category not found"}, 404

    _, others = _usage(cursor, namespace, source_id, user_id)
    if others:
        return _shared_error(namespace, source, others)

    moved = _move_entries(cursor, namespace, source_id, target_id, user_id)
    cursor.execute(f"DELETE FROM {namespace.table} WHERE id = %s", (source_id,))

    return {
        "message": "Categories merged successfully",
        "merged": {"id": source_id, "name": source["name"]},
        "into": {"id": target["id"], "name": target["name"]},
        "moved": moved,
    }, 200
