# Portfolio Test Suite

Comprehensive test suite for the Portfolio time-tracking application. All Python tests run inside Docker — no local database or service setup required.

## Quick Start

```bash
./run_tests.sh
```

This rebuilds all Docker services and runs unit, integration, and E2E tests in a single command.

## Test Structure

```
test/
├── conftest.py                 # Pytest configuration and fixtures
├── test_flask_app.py           # Flask backend unit tests (mocked DB)
├── test_flask_integration.py   # Flask integration tests (real DB)
├── test_security.py            # Security tests (IDOR, SQLi, auth bypass)
├── test_e2e_health.py          # End-to-end health checks
└── test_nextjs_api.test.ts     # Next.js API route tests (Vitest, local only)
```

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

### Next.js API Tests (`test_nextjs_api.test.ts`)
Local development only — not included in the Docker test run.

```bash
cd next-version && npx vitest run ../test/test_nextjs_api.test.ts
```

Covers: Next.js API route handlers, request validation, error handling, auth flow.

## Environment Variables

Set automatically by `docker-compose.test.yml` when using `./run_tests.sh`:

| Variable | Value in Docker |
|----------|----------------|
| `DB_HOST` | `mysql` |
| `FLASK_URL` | `http://flask:3000` |
| `NEXTJS_URL` | `http://nextjs:5000` |
| `RUN_INTEGRATION_TESTS` | `true` |
| `RUN_E2E_TESTS` | `true` |
| `RATELIMIT_ENABLED` | `false` |

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
