# Flask API

The endpoint reference lives in the [root README](../README.md#api-endpoints).
It used to be duplicated here, and the copy drifted: it documented `/users`,
`/entries/<username>` and `/myentries`, none of which exist, and listed nine of
the fifty routes. One list is easier to keep true than two.

## Layout

| File | Holds |
| ---- | ----- |
| `app.py` | The Flask instance and everything shared — config, JWT manager and loaders, rate limiter, connection pool, boot-time migrations, blueprint registration |
| `routes/` | One blueprint per domain: `auth`, `categories`, `entries`, `finance`, `health`, `pomodoro`, `settings`, `todo` |
| `rate_limit.py` | Rate-limit keying, and the per-account throttle on failed logins |
| `query_params.py` | Parsing and SQL building for `?from=&to=&category=&q=&sort=&direction=&limit=&offset=` |
| `categories.py` | Category name normalization |
| `category_admin.py` | Rename / delete / merge, written once for all three category namespaces |
| `finance_due.py` | The daily sweep that completes finance entries whose planned date has passed |
| `itau_pdf.py` | Extracting entries from Itaú statement PDFs |
| `migrations.py`, `migrations/` | Forward-only schema migrations, applied at boot |
| `seed.py` | Development data |

## How the route modules reach shared state

They `import app` and go through the module — `app.get_cursor()`, never
`from app import get_cursor`.

This is load-bearing rather than stylistic. A bound name is a private copy, so
`patch("app.get_cursor")` would not reach it, and 42 tests patch exactly that.
The failure would be silent: those tests would go on running against the real
database and mostly still pass. Going through the module resolves the name when
the view runs, so the patch applies. It also breaks the import cycle — `app.py`
registers the blueprints at the bottom, once everything they reach for exists.

## Boot sequence

`app.py` runs these at import, so they happen under gunicorn too, where there is
no `__main__`:

1. `run_migrations` — raises rather than limping on, so a bad schema stops the
   worker booting instead of failing later per request
2. `normalize_existing_finance_categories` — idempotent tidy-up; never blocks startup
3. `finance_due.start` — the daily sweep. Every worker schedules it and a MySQL
   advisory lock means only one ever runs it. `SCHEDULER_ENABLED=false` turns it
   off, as the test container does
