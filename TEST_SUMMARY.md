# Test Coverage Overview

What the suite proves, tier by tier. For how to run it, see
[`test/README.md`](test/README.md); the short version is `./run_tests.sh`,
which runs everything inside Docker.

**649 Python tests and 23 frontend tests, no skips.** A skip is a real problem
here, not background noise — the two that used to be permanent were stale
(they predated rate limiting being disabled for tests) and are gone.

## Tiers

| Tier | Files | Needs | Proves |
| ---- | ----- | ----- | ------ |
| Frontend routes | `next-version/__tests__/` | nothing (`fetch` mocked) | The Next.js proxies attach credentials, pass errors through, and forward query strings |
| Unit | `test_flask_app.py`, `test_query_params.py`, `test_rate_limit.py` | nothing (DB mocked) | Route logic, validation, parameter parsing, rate-limit keying |
| Integration | `test_flask_integration.py`, `test_categories.py`, `test_settings.py`, `test_task_time_link.py`, `test_list_queries.py`, `test_migrations.py`, `test_finance_due.py` | MySQL | Real queries, transactions, migrations, cross-feature behaviour |
| Security | `test_security.py` | MySQL | IDOR across every resource, auth bypass, SQL injection, token manipulation |
| E2E | `test_e2e_health.py` | the full stack | Service availability, the browser→Next.js→Flask→MySQL path, served CSS |

## What each covers

**Frontend routes.** Cookie handling (the token reaches an httpOnly cookie and
never the response body, on the refresh path as well as at login), error
passthrough (401, 409, 429, a non-JSON upstream, an unreachable Flask), token
refresh, query-string forwarding, and the client-address relay. Deliberately
*not* payload validation — that lives in Flask, and a proxy test asserting its
own 400 is testing the wrong layer.

**Unit.** Health and protected routes, registration and login validation,
category and entry creation, datetime handling. `test_rate_limit.py` turns
limiting on in-process — the only tier that does — and covers per-user keying,
the failed-login throttle, and that a forwarded address is ignored without the
shared secret.

**Integration.** Registration and login against a real database, CRUD across
every resource, batch imports, finance generation, the planned→completed sweep,
category rename/delete/merge in all three namespaces, preferences and password
changes, the pomodoro→time-entry→task chain, and filtering/sorting/paging in
SQL.

**Security.** Every resource is checked for IDOR — one user reaching another's
rows. Auth bypass covers a missing token, an expired one, a tampered payload
and `alg:none`. SQL injection is attempted through every user-controlled field.

**E2E.** Each service answers; the network path from the browser through
Next.js to Flask to MySQL works end to end; a full register→login flow
succeeds. `TestThemeVariantIsUserControlled` reads the stylesheet the browser is
actually served and pins that no `dark:` utility escapes the theme scope — a
bug that lived in what Tailwind compiled, invisible to any source-level check.

## Not in `run_tests.sh`

Playwright specs in `next-version/e2e/` are browser-driven: they need a browser
download and a stack that is already up, so they stay a local step.
