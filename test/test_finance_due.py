"""Planned → done transition tests

Covers flask-server/finance_due.py: the per-user sweep run on every finance
list read, the locked global sweep the daily scheduler calls, and the guard
that keeps the scheduler out of the test process.

These are unit tests — the sweeps are driven against a fake connection, so no
MySQL is required and they run in the default tier. The behaviour against a
real database (that a past-due entry really does read back as done) is covered
in test_flask_integration.py.
"""
import pytest
import logging
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'flask-server'))

import finance_due
from finance_due import (
    LOCK_NAME,
    complete_due_planned_entries,
    scheduler_enabled,
    start,
    sweep_due_planned_entries,
)


class FakeCursor:
    """Stands in for a mysql-connector cursor. Answers GET_LOCK with whatever
    the test asked for and records everything it was told to run."""

    def __init__(self, lock_result=1, fail_on=None, rowcount=0):
        self.executed = []
        self.rowcount = rowcount
        self.closed = False
        self._lock_result = lock_result
        self._fail_on = fail_on
        self._result = []

    def execute(self, sql, params=None):
        if self._fail_on is not None and self._fail_on in sql:
            raise RuntimeError(f"simulated failure executing: {sql!r}")

        self.executed.append((" ".join(sql.split()), params))
        normalized = " ".join(sql.split()).upper()

        if normalized.startswith("SELECT GET_LOCK"):
            self._result = [(self._lock_result,)]
        elif normalized.startswith("SELECT RELEASE_LOCK"):
            self._result = [(1,)]
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


def statements(cursor):
    """The SQL that ran, uppercased, without the lock bookkeeping."""
    return [
        sql.upper()
        for sql, _ in cursor.executed
        if not sql.upper().startswith(("SELECT GET_LOCK", "SELECT RELEASE_LOCK"))
    ]


def updates(cursor):
    return [sql for sql in statements(cursor) if sql.startswith("UPDATE")]


class TestCompleteDuePlannedEntries:
    """The per-user sweep, run on the caller's cursor inside the caller's
    transaction."""

    def test_updates_only_past_due_planned_rows_for_one_user(self):
        cursor = FakeCursor(rowcount=3)

        assert complete_due_planned_entries(cursor, 7) == 3

        sql, params = cursor.executed[0]
        assert sql.upper().startswith("UPDATE FINANCE_ENTRIES")
        assert "SET STATUS = 'DONE'" in sql.upper()
        assert "STATUS = 'PLANNED'" in sql.upper()
        assert "PURCHASE_DATE <= UTC_TIMESTAMP()" in sql.upper()
        assert "USER_ID = %S" in sql.upper()
        assert params == (7,)

    def test_takes_no_lock_and_does_not_commit(self):
        """It joins the caller's transaction; committing here would publish a
        half-finished request."""
        cursor = FakeCursor()

        complete_due_planned_entries(cursor, 1)

        assert not any("LOCK" in sql.upper() for sql, _ in cursor.executed)
        assert not cursor.closed


class TestSweepDuePlannedEntries:
    """The global sweep the daily scheduler calls."""

    def test_updates_every_user_when_the_lock_is_free(self):
        cursor = FakeCursor(lock_result=1, rowcount=12)
        connection = FakeConnection(cursor)

        assert sweep_due_planned_entries(lambda: connection) == 12

        assert len(updates(cursor)) == 1
        sql = updates(cursor)[0]
        assert "SET STATUS = 'DONE'" in sql
        # No user predicate: the scheduled run is for everybody.
        assert "USER_ID" not in sql
        assert connection.commits == 1

    def test_does_nothing_when_another_worker_holds_the_lock(self):
        cursor = FakeCursor(lock_result=0)
        connection = FakeConnection(cursor)

        assert sweep_due_planned_entries(lambda: connection) is None

        assert updates(cursor) == []
        assert connection.commits == 0

    def test_releases_the_lock_and_closes_up_on_success(self):
        cursor = FakeCursor(lock_result=1)
        connection = FakeConnection(cursor)

        sweep_due_planned_entries(lambda: connection)

        assert ("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,)) in cursor.executed
        assert cursor.closed
        assert connection.closed

    def test_releases_the_lock_when_the_update_fails(self):
        """A wedged lock would silence every later sweep, so the release has to
        survive the statement blowing up."""
        cursor = FakeCursor(lock_result=1, fail_on="UPDATE finance_entries")
        connection = FakeConnection(cursor)

        with pytest.raises(RuntimeError):
            sweep_due_planned_entries(lambda: connection)

        assert ("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,)) in cursor.executed
        assert cursor.closed
        assert connection.closed
        assert connection.commits == 0

    def test_does_not_release_a_lock_it_never_took(self):
        cursor = FakeCursor(lock_result=0)

        sweep_due_planned_entries(lambda: FakeConnection(cursor))

        assert not any(
            sql.upper().startswith("SELECT RELEASE_LOCK")
            for sql, _ in cursor.executed
        )


class TestScheduledJob:
    """_run_sweep is what the scheduler thread actually calls."""

    def test_swallows_and_logs_a_failing_sweep(self, monkeypatch, caplog):
        """A raise in the scheduler thread would cost us the run and tell
        nobody; a database blip must not be fatal."""
        def boom(_connect):
            raise RuntimeError("database went away")

        monkeypatch.setattr(finance_due, "sweep_due_planned_entries", boom)

        with caplog.at_level(logging.ERROR, logger="finance_due"):
            finance_due._run_sweep(lambda: None)

        assert "database went away" in caplog.text

    def test_reports_the_row_count(self, monkeypatch, caplog):
        monkeypatch.setattr(
            finance_due, "sweep_due_planned_entries", lambda _connect: 4
        )

        with caplog.at_level(logging.INFO, logger="finance_due"):
            finance_due._run_sweep(lambda: None)

        assert "4" in caplog.text


class TestSchedulerToggle:
    def test_enabled_by_default(self, monkeypatch):
        monkeypatch.delenv("SCHEDULER_ENABLED", raising=False)
        assert scheduler_enabled() is True

    def test_disabled_by_env(self, monkeypatch):
        monkeypatch.setenv("SCHEDULER_ENABLED", "false")
        assert scheduler_enabled() is False

    def test_start_is_a_no_op_when_disabled(self, monkeypatch):
        """This is what keeps a background thread from writing underneath the
        test suite's own fixtures."""
        monkeypatch.setenv("SCHEDULER_ENABLED", "false")
        monkeypatch.setattr(finance_due, "_scheduler", None)

        assert start(lambda: None) is None
        assert finance_due._scheduler is None
