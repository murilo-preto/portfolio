"""Completing finance entries whose planned date has arrived.

Finance entries are written ahead of time — `/finance/batch-generate`
materialises a year of monthly bills in one go, all `planned` — and until this
module existed nothing ever moved one off `planned`. A bill paid last March
still read as pending, so every "planned" total was really "planned, plus
everything the user forgot to tick off".

Two callers run the same transition, for different reasons:

* `sweep_due_planned_entries` runs on a daily schedule over every user, so the
  table is correct whether or not anyone logs in — a CSV export or any future
  server-side report is right on its own.
* `complete_due_planned_entries` runs on the finance list read for the one user
  doing the reading, so the flip is immediate rather than up to a day late.

They are the same UPDATE differing only by a `user_id` predicate, and they live
together here so they cannot drift apart.

`purchase_date` is stored as naive UTC — the create and PUT handlers reject a
date with no offset and convert before binding — so `UTC_TIMESTAMP()` is the
right comparison. An entry dated local midnight flips at local midnight.
"""

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Every gunicorn worker boots this module and so schedules its own daily tick.
# The sweep is serialised with a MySQL advisory lock, taken with a zero
# timeout: the first worker to the tick does the work and the rest see the lock
# held and return immediately rather than queueing up to redo it. GET_LOCK is
# scoped to the connection that took it, hence one connection held across the
# whole call rather than a statement-at-a-time borrow from the pool.
LOCK_NAME = "namu_finance_due_sweep"

# Just after midnight UTC, not on the hour, to stay clear of whatever else on a
# host wakes up at :00.
SWEEP_HOUR_UTC = 0
SWEEP_MINUTE_UTC = 5

_COMPLETE_DUE_PLANNED = """
    UPDATE finance_entries
    SET status = 'done'
    WHERE status = 'planned'
      AND purchase_date <= UTC_TIMESTAMP()
"""

_scheduler = None


def scheduler_enabled():
    """False when SCHEDULER_ENABLED=false — set in the test compose file, where
    a background thread writing under a test's fixtures would make failures
    non-reproducible."""
    return os.getenv("SCHEDULER_ENABLED", "true").lower() != "false"


def complete_due_planned_entries(cursor, user_id):
    """Flip one user's past-due planned entries, on a cursor the caller owns.

    Deliberately takes no lock and does not commit: it joins the caller's
    transaction, so the SELECT that follows it cannot observe a half-applied
    sweep. Idempotent — a second call matches nothing.
    """
    cursor.execute(_COMPLETE_DUE_PLANNED + " AND user_id = %s", (user_id,))
    return cursor.rowcount


def sweep_due_planned_entries(connect):
    """Flip every past-due planned entry, for every user, under the advisory
    lock.

    Returns the number of rows changed, or None if another worker held the lock
    and this call did nothing.
    """
    connection = connect()
    cursor = connection.cursor()
    try:
        cursor.execute("SELECT GET_LOCK(%s, 0)", (LOCK_NAME,))
        acquired = cursor.fetchone()[0]
        if acquired != 1:
            # Another worker is already sweeping. The work is global, so there
            # is nothing left for this one to do.
            return None

        try:
            cursor.execute(_COMPLETE_DUE_PLANNED)
            connection.commit()
            return cursor.rowcount
        finally:
            cursor.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
            cursor.fetchall()
    finally:
        cursor.close()
        connection.close()


def _run_sweep(connect):
    """The scheduled job body. Swallows and logs its own failures: an exception
    raised in the scheduler thread would be reported and the run lost, and a
    transient database blip must not cost us tomorrow's sweep."""
    try:
        changed = sweep_due_planned_entries(connect)
        if changed is None:
            logger.debug("Finance due sweep skipped; another worker holds the lock")
        elif changed:
            logger.info(f"Finance due sweep completed {changed} planned entries")
    except Exception as e:
        logger.error(f"Finance due sweep failed: {e}")


def start(connect):
    """Start the daily sweep in a background thread. Returns the scheduler, or
    None when disabled.

    Two jobs: the daily tick, and a one-shot run now so a container that was
    down over midnight corrects itself at boot without blocking startup.
    """
    global _scheduler

    if not scheduler_enabled():
        logger.info("Finance due sweep disabled (SCHEDULER_ENABLED=false)")
        return None

    if _scheduler is not None:
        return _scheduler

    from apscheduler.schedulers.background import BackgroundScheduler

    # Four workers each narrating every job they add, run and remove buries the
    # one line worth reading — the row count from whichever worker won the lock.
    logging.getLogger("apscheduler").setLevel(logging.WARNING)

    scheduler = BackgroundScheduler(timezone="UTC", daemon=True)
    scheduler.add_job(
        _run_sweep,
        "cron",
        args=[connect],
        hour=SWEEP_HOUR_UTC,
        minute=SWEEP_MINUTE_UTC,
        id="finance_due_sweep",
        # A suspended container wakes to one catch-up run, not a backlog of
        # every tick it slept through.
        coalesce=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _run_sweep,
        "date",
        args=[connect],
        run_date=datetime.now(timezone.utc),
        id="finance_due_sweep_boot",
    )
    scheduler.start()

    _scheduler = scheduler
    return scheduler
