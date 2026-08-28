"""Flask application core.

Holds the Flask instance and everything shared: configuration, the JWT manager
and its loaders, the rate limiter, the connection pool, and boot-time schema
work. The routes themselves live in `routes/`, one blueprint per domain, and
are registered at the bottom of this file.

Route modules reach back here with `import app` and go through the module —
`app.get_cursor()`, not a name bound at import time. That is deliberate: it
resolves when the view runs, so `patch("app.get_cursor")` reaches the routes
too, and it means this file can be most of the way built before they load.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import logging
import os
import threading

from flask import Flask, jsonify
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt,
    get_jwt_identity,
    set_access_cookies,
)
from flask_limiter import Limiter
from mysql.connector import Error
from mysql.connector.pooling import MySQLConnectionPool

from categories import normalize_category_name
import finance_due
from migrations import run_migrations
from rate_limit import limiter_key

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY")
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_ACCESS_COOKIE_NAME"] = "access_token"
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(
    hours=int(os.getenv("TOKEN_DURATION_HOURS", "48"))
)

if not app.config["JWT_SECRET_KEY"]:
    raise RuntimeError("JWT_SECRET_KEY environment variable is not set")

# Statement PDFs are a few hundred KB; cap them well above that, and cap a
# whole multi-file upload well above that again. Flask rejects a request body
# larger than MAX_CONTENT_LENGTH before it reaches a route handler.
MAX_PDF_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_UPLOAD_COUNT = 24
MAX_BULK_DELETE_IDS = 500
MAX_GENERATE_ROWS = 1000
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

# Rate limiting — disabled when RATELIMIT_ENABLED=false (e.g. in tests).
#
# The key is the authenticated user where there is one, and the client address
# otherwise; see rate_limit.py for why the stock get_remote_address cannot be
# used behind the Next.js proxy.
_ratelimit_enabled = os.getenv("RATELIMIT_ENABLED", "true").lower() != "false"
limiter = Limiter(
    app=app,
    key_func=limiter_key,
    default_limits=["100 per hour", "20 per minute"],
    storage_uri="memory://",
    # Built enabled and switched off below, rather than constructed disabled.
    # Flask-Limiter's init_app returns before it opens storage or registers its
    # request hooks when it is disabled, leaving a half-built extension that
    # cannot be turned back on later — Flask rejects a before_request hook once
    # the app has served a request. A fully built limiter with `enabled` false
    # exempts every limit just the same, and stays switchable in-process, which
    # is what lets test_rate_limit.py cover limiting at all.
    enabled=True,
)
limiter.enabled = _ratelimit_enabled
app.config["RATELIMIT_ENABLED"] = _ratelimit_enabled


@app.errorhandler(429)
def rate_limit_exceeded(e):
    """Answer a throttled request in JSON like every other endpoint.

    Flask-Limiter's default 429 is an HTML page. Every caller here is an API
    client that parses JSON, so the HTML surfaced as a parse failure rather
    than as "you are going too fast" — the Next.js login and register proxies
    turned it into a blank 500, which is what the user actually saw.
    """
    return jsonify(
        {
            "error": "Too many requests. Please wait and try again.",
            "detail": str(e.description),
        }
    ), 429


jwt = JWTManager(app)

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
}

missing = [k for k, v in DB_CONFIG.items() if not v]
if missing:
    raise RuntimeError(f"Missing required DB environment variables: {missing}")

_pool = None
_pool_lock = threading.Lock()


def get_pool():
    """Return the connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = MySQLConnectionPool(
                    pool_name="time_tracker_pool", pool_size=5, **DB_CONFIG
                )
    return _pool


@contextmanager
def get_cursor(dictionary=True):
    """
    Context manager that acquires a pooled connection, yields a cursor,
    commits on success, rolls back on error, and always cleans up.

    Usage:
        with get_cursor() as cursor:
            cursor.execute(...)
    """
    connection = get_pool().get_connection()
    cursor = connection.cursor(dictionary=dictionary)
    try:
        yield cursor
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


def normalize_existing_finance_categories():
    """Bring already-stored finance category names in line with
    normalize_category_name, so names created before normalization existed
    (all of them shouted, having come from statement PDFs) stop shouting.

    Idempotent and safe to run on every boot: a second pass finds nothing to
    do, and finance_entries reference categories by id, so renaming only
    changes the displayed name. Runs per gunicorn worker, hence the
    tolerance for a concurrent worker having renamed a row first.
    """
    try:
        with get_cursor() as cursor:
            cursor.execute("SELECT id, name FROM finance_categories")
            rows = cursor.fetchall()

            renamed = 0
            for row in rows:
                normalized = normalize_category_name(row["name"])
                if normalized == row["name"]:
                    continue
                try:
                    cursor.execute(
                        "UPDATE finance_categories SET name = %s WHERE id = %s",
                        (normalized, row["id"]),
                    )
                    renamed += 1
                except Error as e:
                    # Only reachable if normalizing collapses two names onto
                    # one another; leave both alone rather than merging.
                    logger.warning(
                        f"Skipped renaming category {row['name']!r}: {e}"
                    )

        if renamed:
            logger.info(f"Normalized {renamed} finance category name(s)")

    except Error as e:
        # Never let a tidy-up keep the API from starting.
        logger.error(f"Could not normalize finance category names: {e}")


@app.after_request
def refresh_expiring_jwts(response):
    try:
        exp_timestamp = get_jwt()["exp"]
        now = datetime.now(timezone.utc)
        target_timestamp = datetime.timestamp(now + timedelta(hours=24))
        if target_timestamp > exp_timestamp:
            access_token = create_access_token(identity=get_jwt_identity())
            set_access_cookies(response, access_token)
        return response
    except (RuntimeError, KeyError):
        return response


@jwt.unauthorized_loader
def unauthorized_callback(callback):
    return jsonify(error="Missing or invalid token"), 401


@jwt.invalid_token_loader
def invalid_token_callback(callback):
    return jsonify(error="Invalid token"), 401


@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_payload):
    return jsonify(error="Token expired"), 401


# ─── Blueprints ───────────────────────────────────────────────────────────────
#
# Imported here, at the bottom, rather than at the top: each route module does
# `import app`, so this file has to be substantially built before they load.
# Everything they reach for — the Flask instance, the limiter, get_cursor — is
# defined above.
#
# They resolve those through the module (`app.get_cursor()`) rather than binding
# them at import (`from app import get_cursor`). That is what keeps
# `patch("app.get_cursor")` effective, which 42 tests rely on; a bound name
# would be a private copy the patch could never reach.
from routes.auth import auth_bp  # noqa: E402
from routes.categories import categories_bp  # noqa: E402
from routes.entries import entries_bp  # noqa: E402
from routes.finance import finance_bp  # noqa: E402
from routes.health import health_bp  # noqa: E402
from routes.pomodoro import pomodoro_bp  # noqa: E402
from routes.settings import settings_bp  # noqa: E402
from routes.todo import todo_bp  # noqa: E402

for blueprint in (
    auth_bp,
    categories_bp,
    entries_bp,
    finance_bp,
    health_bp,
    pomodoro_bp,
    settings_bp,
    todo_bp,
):
    app.register_blueprint(blueprint)

# Re-exported because test_flask_app.py imports it from here. It belongs to the
# entries module; this keeps the test suite untouched by the split.
from routes.entries import retrieve_entry_from_username  # noqa: E402,F401


# Runs under gunicorn too, where there is no __main__. Compose only starts this
# service once MySQL reports healthy, so the pool is ready by now.
#
# Migrations come first: everything below, and every request handler, assumes an
# up-to-date schema. run_migrations raises rather than limping on, so a failure
# here stops the worker booting.
run_migrations(lambda: get_pool().get_connection())
normalize_existing_finance_categories()

# Daily sweep completing finance entries whose planned date has passed. Every
# worker schedules it; a MySQL advisory lock means only one ever runs it.
finance_due.start(lambda: get_pool().get_connection())


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 3000)),
        debug=os.getenv("FLASK_DEBUG", "False").lower() == "true",
    )
