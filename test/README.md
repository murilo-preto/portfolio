# Portfolio Test Suite

Comprehensive test suite for the Portfolio time-tracking application. All Python tests run inside Docker — no local database or service setup required.

## Quick Start

```bash
./run_tests.sh
```

This runs the Next.js route tests, then rebuilds all Docker services and runs
the unit, integration and E2E tiers. Expect **649 Python tests and 23 frontend
tests, with no skips** — anything skipping is a real problem, not background
noise.

Note that `Dockerfile.test` copies the repo in at build time, so
`docker compose run test` executes whatever was present when the image was last
built. Rebuild after editing tests or `flask-server/`.

## Test Structure

```
test/
├── conftest.py                 # Pytest configuration and fixtures
├── test_flask_app.py           # Flask backend unit tests (mocked DB)
├── test_flask_integration.py   # Flask integration tests (real DB)
├── test_security.py            # Security tests (IDOR, SQLi, auth bypass)
├── test_rate_limit.py          # Rate-limit keying and the failed-login throttle
├── test_categories.py          # Category rename / delete / merge, all three namespaces
├── test_settings.py            # Preferences and password changes
├── test_task_time_link.py      # Pomodoro → time entry → task linking
├── test_list_queries.py        # Filter / search / sort / page against the DB
├── test_query_params.py        # Query parameter parsing in isolation
├── test_migrations.py          # The forward-only migration runner
├── test_finance_due.py         # Planned → completed finance sweep
└── test_e2e_health.py          # End-to-end checks through the running stack
```

The Next.js route handlers are tested separately, in
`next-version/__tests__/api.test.ts` (Vitest). `./run_tests.sh` runs that suite
too — see below.

## Test Types

### Flask Unit Tests (`test_flask_app.py`)
No external dependencies — all DB calls are mocked.

Covers: health endpoints, JWT auth, input validation, route logic.

### Integration Tests (`test_flask_integration.py`)
Requires a live MySQL database (provided by Docker Compose).

Covers: DB connectivity, register/login, category and time entry CRUD, batch imports.

### Security Tests (`test_security.py`)
Requires a live MySQL database (provided by Docker Compose).

Covers: IDOR across all resource types, authentication bypass (no token / expired / tampered / `alg:none`), SQL injection across all user-controlled fields, token manipulation.

### E2E Health Tests (`test_e2e_health.py`)
Requires all services running (provided by Docker Compose).

Covers: service availability, health endpoint response time, DB reachability through the app, full register→login flow, Next.js→Flask network path.

### Next.js Route Tests (`next-version/__tests__/api.test.ts`)
Run by `./run_tests.sh` ahead of the Python tiers. `fetch` is mocked, so this
needs neither MySQL nor Flask and finishes in seconds. On its own:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm nextjs-test
```

Covers what the proxy layer actually does: cookie handling, error passthrough
(401, 409, 429, non-JSON upstream, unreachable Flask), token refresh, and
query-string forwarding.

Note that these routes do **not** validate payloads — that is Flask's job. A
test asserting the proxy rejects a bad body with its own 400 is testing the
wrong layer; the suite this replaced was full of them and had never been run.

### Browser Tests (`next-version/e2e/`, Playwright)
Local only — needs a browser download and a stack that is already running:

```bash
docker compose up --build          # in another terminal
cd next-version && npx playwright test
```

## Environment Variables

Set automatically by `docker-compose.test.yml` when using `./run_tests.sh`:

| Variable | Value in Docker |
|----------|----------------|
| `DB_HOST` | `mysql` |
| `FLASK_URL` | `http://flask:3000` |
| `NEXTJS_URL` | `http://nextjs:5000` |
| `RUN_INTEGRATION_TESTS` | `true` |
| `RUN_E2E_TESTS` | `true` |
| `RATELIMIT_ENABLED` | `false` — on the `flask` service as well as `test`, so the e2e tier is not throttled by a cap it shares with itself |
| `SCHEDULER_ENABLED` | `false` on `test` only; the `flask` service keeps its scheduler so e2e exercises the real boot path |

## Adding New Tests

Mark tests with the appropriate pytest marker so they're documented and filterable:

```python
@pytest.mark.integration
def test_database_operation(client):
    ...

@pytest.mark.e2e
def test_full_user_journey():
    ...
```

No additional configuration is needed — all marked tests run automatically inside Docker.
