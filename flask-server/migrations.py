"""Forward-only schema migrations.

`mysql/schema.sql` is mounted into MySQL's `docker-entrypoint-initdb.d`, so it
runs *only* on a fresh volume. It therefore cannot evolve a database that
already holds data — changing a column used to mean `docker compose down -v`.
Every schema change after the baseline lands here instead, as a numbered .sql
file applied once, in order, at Flask boot.

Conventions
-----------
* Files live in `migrations/` beside this module, named `NNN_slug.sql`
  (e.g. `001_add_time_entry_note.sql`). The `NNN` prefix defines apply order.
* A file is applied exactly once and its name recorded in `schema_migrations`.
  Never edit or renumber a file that has already shipped — add a new one.
* Statements are separated by `;`. Keep to plain DDL/DML: no stored routines or
  triggers, nothing needing a custom DELIMITER.
* MySQL DDL auto-commits and is not transactional, so a file that fails halfway
  leaves its earlier statements applied. Prefer one statement per file, or
  statements that are safe to re-run.
* `mysql/schema.sql` stays frozen as the baseline. A fresh volume gets
  schema.sql plus every migration; an existing volume gets only the migrations
  it is missing. Both converge on the same schema.
"""

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

# Gunicorn runs four workers and each one boots this module, so the run is
# serialised with a MySQL advisory lock. GET_LOCK is scoped to the connection
# that took it, which is why the whole run holds a single connection rather
# than borrowing one per statement from the pool.
LOCK_NAME = "namu_schema_migrations"
LOCK_TIMEOUT_SECONDS = 60

CREATE_MIGRATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_LINE_COMMENT = re.compile(r"^\s*(--|#)")


def split_statements(sql):
    """Split a migration file into individual statements.

    Line comments are stripped first, so a `;` inside one cannot terminate a
    statement early. Block comments and semicolons inside string literals are
    not handled — see the module docstring on what a migration may contain.
    """
    body = "\n".join(
        line for line in sql.splitlines() if not _LINE_COMMENT.match(line)
    )
    return [stmt.strip() for stmt in body.split(";") if stmt.strip()]


def discover_migrations():
    """Every migration file, in the order its NNN prefix says to apply it."""
    if not MIGRATIONS_DIR.is_dir():
        return []
    return sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if p.is_file())


def _apply_pending(connection, cursor):
    cursor.execute("SELECT version FROM schema_migrations")
    applied = {row[0] for row in cursor.fetchall()}

    pending = [p for p in discover_migrations() if p.name not in applied]
    if not pending:
        logger.info(
            f"Schema is up to date ({len(applied)} migration(s) already applied)"
        )
        return

    for path in pending:
        statements = split_statements(path.read_text(encoding="utf-8"))
        logger.info(f"Applying migration {path.name} ({len(statements)} statement(s))")
        for statement in statements:
            cursor.execute(statement)
        # Recorded only once every statement in the file has succeeded.
        cursor.execute(
            "INSERT INTO schema_migrations (version) VALUES (%s)", (path.name,)
        )
        connection.commit()
        logger.info(f"Applied migration {path.name}")


def run_migrations(get_connection):
    """Apply every migration this database has not seen yet.

    `get_connection` is a callable returning a fresh connection, kept as an
    argument so this module does not import back into app.py.

    Raises on failure, unlike the cosmetic normalize_existing_finance_categories():
    a worker that cannot bring the schema up to date must not go on to serve
    requests against it. A crash-looping container is the correct signal that a
    migration needs attention.
    """
    connection = get_connection()
    cursor = connection.cursor()
    try:
        cursor.execute(CREATE_MIGRATIONS_TABLE)
        connection.commit()

        cursor.execute(
            "SELECT GET_LOCK(%s, %s)", (LOCK_NAME, LOCK_TIMEOUT_SECONDS)
        )
        acquired = cursor.fetchone()[0]
        if acquired != 1:
            # Another worker has held the lock past the timeout, which means its
            # migration run is wedged. Starting anyway would race it.
            raise RuntimeError(
                f"Timed out after {LOCK_TIMEOUT_SECONDS}s waiting for the "
                f"{LOCK_NAME!r} lock; another worker may be mid-migration"
            )

        try:
            _apply_pending(connection, cursor)
        finally:
            cursor.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
            cursor.fetchall()
    finally:
        cursor.close()
        connection.close()
