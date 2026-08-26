"""
Schema migration runner tests

Covers flask-server/migrations.py: statement parsing, discovery order, the
apply/record loop, idempotency, advisory locking, and cleanup on failure.

These are unit tests — the runner is driven against a fake connection, so no
MySQL is required and they run in the default tier.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

from migrations import (
    split_statements,
    discover_migrations,
    run_migrations,
    LOCK_NAME,
)
import migrations as migrations_module


class FakeCursor:
    """Stands in for a mysql-connector cursor, recording what it was asked to
    run and answering the handful of SELECTs the runner makes."""

    def __init__(self, applied=None, lock_result=1, fail_on=None):
        self.executed = []
        self.applied = list(applied or [])
        self._lock_result = lock_result
        self._fail_on = fail_on
        self._result = []
        self.closed = False

    def execute(self, sql, params=None):
        if self._fail_on is not None and self._fail_on in sql:
            raise RuntimeError(f"simulated failure executing: {sql!r}")

        self.executed.append((" ".join(sql.split()), params))
        normalized = " ".join(sql.split()).upper()

        if normalized.startswith("SELECT VERSION FROM SCHEMA_MIGRATIONS"):
            self._result = [(v,) for v in self.applied]
        elif normalized.startswith("SELECT GET_LOCK"):
            self._result = [(self._lock_result,)]
        elif normalized.startswith("SELECT RELEASE_LOCK"):
            self._result = [(1,)]
        elif normalized.startswith("INSERT INTO SCHEMA_MIGRATIONS"):
            self.applied.append(params[0])
            self._result = []
        else:
            self._result = []

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return list(self._result)

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commits = 0
        self.closed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def write_migrations(tmp_path, monkeypatch, files):
    """Point the runner at a throwaway migrations directory."""
    for name, body in files.items():
        (tmp_path / name).write_text(body, encoding="utf-8")
    monkeypatch.setattr(migrations_module, "MIGRATIONS_DIR", tmp_path)
    return tmp_path


def ddl_statements(cursor):
    """Just the migration DDL, dropping the runner's own bookkeeping."""
    skip = ("CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS", "SELECT ", "INSERT INTO SCHEMA_MIGRATIONS")
    return [
        sql for sql, _ in cursor.executed
        if not any(sql.upper().startswith(p) for p in skip)
    ]


class TestSplitStatements:
    def test_splits_on_semicolons(self):
        assert split_statements("SELECT 1; SELECT 2;") == ["SELECT 1", "SELECT 2"]

    def test_ignores_trailing_semicolon_and_blank_lines(self):
        assert split_statements("SELECT 1;\n\n\n") == ["SELECT 1"]

    def test_strips_dash_line_comments(self):
        sql = "-- add a column; not a statement\nALTER TABLE t ADD COLUMN c INT;"
        assert split_statements(sql) == ["ALTER TABLE t ADD COLUMN c INT"]

    def test_strips_hash_line_comments(self):
        sql = "# hash comment; still not a statement\nSELECT 1;"
        assert split_statements(sql) == ["SELECT 1"]

    def test_empty_file_yields_no_statements(self):
        assert split_statements("\n  \n-- only a comment\n") == []

    def test_preserves_multiline_statement(self):
        sql = "ALTER TABLE t\n  ADD COLUMN c INT;"
        assert split_statements(sql) == ["ALTER TABLE t\n  ADD COLUMN c INT"]


class TestDiscoverMigrations:
    def test_orders_by_numeric_prefix(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "010_third.sql": "SELECT 3;",
            "002_second.sql": "SELECT 2;",
            "001_first.sql": "SELECT 1;",
        })
        assert [p.name for p in discover_migrations()] == [
            "001_first.sql", "002_second.sql", "010_third.sql",
        ]

    def test_ignores_non_sql_files(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_real.sql": "SELECT 1;",
            "README.md": "not a migration",
            "notes.txt": "also not",
        })
        assert [p.name for p in discover_migrations()] == ["001_real.sql"]

    def test_missing_directory_is_not_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            migrations_module, "MIGRATIONS_DIR", tmp_path / "does-not-exist"
        )
        assert discover_migrations() == []


class TestRunMigrations:
    def test_applies_pending_in_order_and_records_them(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_a.sql": "ALTER TABLE a ADD COLUMN x INT;",
            "002_b.sql": "ALTER TABLE b ADD COLUMN y INT;",
        })
        cursor = FakeCursor()
        connection = FakeConnection(cursor)

        run_migrations(lambda: connection)

        assert ddl_statements(cursor) == [
            "ALTER TABLE a ADD COLUMN x INT",
            "ALTER TABLE b ADD COLUMN y INT",
        ]
        assert cursor.applied == ["001_a.sql", "002_b.sql"]

    def test_applies_every_statement_in_a_multi_statement_file(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_multi.sql": "ALTER TABLE a ADD COLUMN x INT;\nALTER TABLE a ADD COLUMN y INT;",
        })
        cursor = FakeCursor()

        run_migrations(lambda: FakeConnection(cursor))

        assert ddl_statements(cursor) == [
            "ALTER TABLE a ADD COLUMN x INT",
            "ALTER TABLE a ADD COLUMN y INT",
        ]
        assert cursor.applied == ["001_multi.sql"]

    def test_already_applied_migrations_are_skipped(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_a.sql": "ALTER TABLE a ADD COLUMN x INT;",
            "002_b.sql": "ALTER TABLE b ADD COLUMN y INT;",
        })
        cursor = FakeCursor(applied=["001_a.sql"])

        run_migrations(lambda: FakeConnection(cursor))

        assert ddl_statements(cursor) == ["ALTER TABLE b ADD COLUMN y INT"]
        assert cursor.applied == ["001_a.sql", "002_b.sql"]

    def test_second_run_is_a_no_op(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_a.sql": "ALTER TABLE a ADD COLUMN x INT;",
        })
        first = FakeCursor()
        run_migrations(lambda: FakeConnection(first))

        # A fresh worker booting against the now-migrated database.
        second = FakeCursor(applied=list(first.applied))
        run_migrations(lambda: FakeConnection(second))

        assert ddl_statements(second) == []
        assert second.applied == ["001_a.sql"]

    def test_empty_migrations_directory_applies_nothing(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {})
        cursor = FakeCursor()

        run_migrations(lambda: FakeConnection(cursor))

        assert ddl_statements(cursor) == []
        assert cursor.applied == []

    def test_creates_bookkeeping_table_before_reading_it(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {})
        cursor = FakeCursor()

        run_migrations(lambda: FakeConnection(cursor))

        statements = [sql.upper() for sql, _ in cursor.executed]
        create = next(i for i, s in enumerate(statements) if s.startswith("CREATE TABLE IF NOT EXISTS SCHEMA_MIGRATIONS"))
        read = next(i for i, s in enumerate(statements) if s.startswith("SELECT VERSION FROM SCHEMA_MIGRATIONS"))
        assert create < read


class TestLocking:
    def test_takes_and_releases_the_advisory_lock(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_a.sql": "SELECT 1;"})
        cursor = FakeCursor()

        run_migrations(lambda: FakeConnection(cursor))

        params = [p for _, p in cursor.executed if p]
        assert (LOCK_NAME, migrations_module.LOCK_TIMEOUT_SECONDS) in params
        assert (LOCK_NAME,) in params

    def test_lock_is_released_even_when_a_migration_fails(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_bad.sql": "ALTER TABLE nope;"})
        cursor = FakeCursor(fail_on="ALTER TABLE nope")

        with pytest.raises(RuntimeError):
            run_migrations(lambda: FakeConnection(cursor))

        released = [sql for sql, _ in cursor.executed if "RELEASE_LOCK" in sql.upper()]
        assert released, "advisory lock was not released after a failure"

    def test_failure_to_acquire_the_lock_raises(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_a.sql": "SELECT 1;"})
        cursor = FakeCursor(lock_result=0)

        with pytest.raises(RuntimeError, match="Timed out"):
            run_migrations(lambda: FakeConnection(cursor))

        assert cursor.applied == []


class TestFailureHandling:
    def test_failed_migration_is_not_recorded_as_applied(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_bad.sql": "ALTER TABLE nope;"})
        cursor = FakeCursor(fail_on="ALTER TABLE nope")

        with pytest.raises(RuntimeError):
            run_migrations(lambda: FakeConnection(cursor))

        assert cursor.applied == [], "a failed migration must stay pending"

    def test_a_later_migration_does_not_run_after_an_earlier_one_fails(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {
            "001_bad.sql": "ALTER TABLE nope;",
            "002_good.sql": "ALTER TABLE fine ADD COLUMN c INT;",
        })
        cursor = FakeCursor(fail_on="ALTER TABLE nope")

        with pytest.raises(RuntimeError):
            run_migrations(lambda: FakeConnection(cursor))

        assert "ALTER TABLE fine ADD COLUMN c INT" not in ddl_statements(cursor)
        assert cursor.applied == []

    def test_connection_and_cursor_are_closed_on_failure(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_bad.sql": "ALTER TABLE nope;"})
        cursor = FakeCursor(fail_on="ALTER TABLE nope")
        connection = FakeConnection(cursor)

        with pytest.raises(RuntimeError):
            run_migrations(lambda: connection)

        assert cursor.closed, "cursor leaked"
        assert connection.closed, "connection leaked"

    def test_connection_and_cursor_are_closed_on_success(self, tmp_path, monkeypatch):
        write_migrations(tmp_path, monkeypatch, {"001_a.sql": "SELECT 1;"})
        cursor = FakeCursor()
        connection = FakeConnection(cursor)

        run_migrations(lambda: connection)

        assert cursor.closed
        assert connection.closed


class TestShippedMigrations:
    """Guards on the real migrations/ directory, not a temporary one."""

    def test_filenames_follow_the_numbered_convention(self):
        import re
        for path in discover_migrations():
            assert re.match(r"^\d{3}_[a-z0-9_]+\.sql$", path.name), (
                f"{path.name} does not match NNN_slug.sql"
            )

    def test_version_prefixes_are_unique(self):
        prefixes = [p.name[:3] for p in discover_migrations()]
        assert len(prefixes) == len(set(prefixes)), f"duplicate prefix in {prefixes}"

    def test_every_shipped_migration_parses(self):
        for path in discover_migrations():
            statements = split_statements(path.read_text(encoding="utf-8"))
            assert statements, f"{path.name} contains no statements"


@pytest.mark.integration
class TestAgainstRealMySQL:
    """End-to-end proof against a live database: the fakes above cannot
    exercise GET_LOCK, real DDL, or the bookkeeping table itself."""

    THROWAWAY_TABLE = "migration_runner_probe"

    @pytest.fixture
    def db(self):
        if os.getenv("RUN_INTEGRATION_TESTS") != "true":
            pytest.skip("Integration tests not enabled. Set RUN_INTEGRATION_TESTS=true")

        import mysql.connector

        config = {
            "host": os.getenv("DB_HOST", "localhost"),
            "port": int(os.getenv("DB_PORT", "3306")),
            "user": os.getenv("DB_USER"),
            "password": os.getenv("DB_PASSWORD"),
            "database": os.getenv("DB_NAME"),
        }
        connect = lambda: mysql.connector.connect(**config)

        verifier = connect()
        try:
            yield connect, verifier
        finally:
            cursor = verifier.cursor()
            cursor.execute(f"DROP TABLE IF EXISTS {self.THROWAWAY_TABLE}")
            cursor.execute(
                "DELETE FROM schema_migrations WHERE version LIKE %s",
                ("999_probe%",),
            )
            verifier.commit()
            cursor.close()
            verifier.close()

    def table_exists(self, verifier, name):
        cursor = verifier.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = %s",
            (name,),
        )
        found = cursor.fetchone()[0]
        cursor.close()
        return found == 1

    def recorded_versions(self, verifier):
        cursor = verifier.cursor()
        cursor.execute("SELECT version FROM schema_migrations")
        versions = {row[0] for row in cursor.fetchall()}
        cursor.close()
        return versions

    def test_applies_real_ddl_and_records_it(self, db, tmp_path, monkeypatch):
        connect, verifier = db
        write_migrations(tmp_path, monkeypatch, {
            "999_probe.sql": (
                f"CREATE TABLE {self.THROWAWAY_TABLE} "
                "(id INT PRIMARY KEY AUTO_INCREMENT, label VARCHAR(20));"
            ),
        })

        run_migrations(connect)

        assert self.table_exists(verifier, self.THROWAWAY_TABLE)
        assert "999_probe.sql" in self.recorded_versions(verifier)

    def test_rerun_against_a_migrated_database_is_a_no_op(self, db, tmp_path, monkeypatch):
        connect, verifier = db
        write_migrations(tmp_path, monkeypatch, {
            "999_probe.sql": (
                f"CREATE TABLE {self.THROWAWAY_TABLE} "
                "(id INT PRIMARY KEY AUTO_INCREMENT);"
            ),
        })

        run_migrations(connect)
        # A second pass must not re-run the CREATE, which would raise
        # "table already exists" — this is the boot path every worker takes.
        run_migrations(connect)

        assert self.table_exists(verifier, self.THROWAWAY_TABLE)

    def test_bookkeeping_table_is_created_by_the_runner(self, db):
        connect, verifier = db
        run_migrations(connect)
        assert self.table_exists(verifier, "schema_migrations")

    def test_advisory_lock_is_not_left_held(self, db):
        connect, verifier = db
        run_migrations(connect)

        cursor = verifier.cursor()
        # IS_FREE_LOCK returns 1 when nobody holds it.
        cursor.execute("SELECT IS_FREE_LOCK(%s)", (LOCK_NAME,))
        free = cursor.fetchone()[0]
        cursor.close()
        assert free == 1, "runner left the advisory lock held"
