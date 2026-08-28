# Agent Guidelines

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

### Development
```bash
# Start all services (MySQL + Flask + Next.js)
docker compose up --build

# Build only (verifies TypeScript and Python compile)
docker compose build

# Frontend dev server (port 5000)
cd next-version && npm run dev

# Frontend lint — through Docker, since there is no local node_modules
cd next-version && docker build --target builder -t portfolio-nextjs-builder . \
  && docker run --rm portfolio-nextjs-builder npm run lint
```

`docker compose build` typechecks the frontend (Next's build runs `tsc`) but
does not surface ESLint warnings, so run the lint command separately. The repo
is kept at zero warnings — treat any warning as a failure.

### Testing

Everything runs inside Docker — no local Python, Node or MySQL setup required.
One command covers both tiers:

```bash
./run_tests.sh
```

It runs the Next.js route tests first (Vitest; mocks `fetch`, so it needs
neither MySQL nor Flask and reports in seconds), then the Python suite — unit,
integration, e2e — against the full stack. Expect **649 Python tests and 23
frontend tests, with no skips**; anything skipping is a real problem.

To run one tier on its own while iterating:

```bash
# Frontend only
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm nextjs-test

# One Python test file (rebuild first — Dockerfile.test bakes the repo in)
docker compose -f docker-compose.yml -f docker-compose.test.yml build test
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm test \
  pytest test/test_rate_limit.py -v
```

Covers: health endpoints, authentication (register, login, JWT), rate-limit
keying, input validation, DB operations (CRUD, transactions), API integration
(Flask ↔ Next.js), proxy behaviour (cookies, error passthrough, token refresh),
security (IDOR, SQLi, auth bypass, token manipulation).

Playwright (`next-version/e2e/`) is browser-driven and deliberately outside
`run_tests.sh` — it needs a browser download and a stack that is already up:

```bash
docker compose up --build          # in another terminal
cd next-version && npx playwright test
```

### Health verification
```bash
curl http://localhost:3000/health   # Flask
curl http://localhost:5000/api/health  # Next.js
```

## Pre-Deployment Checklist

Before considering a task complete:

1. **Build**: `docker compose build` (catches TypeScript/Python compile errors early)
2. **Full Suite**: `./run_tests.sh`
3. **Verify Health**: All endpoints return 200

## Common Build Issues

- **Next.js TypeScript errors**: Fix type mismatches in `.tsx` files
- **Flask errors**: Check Python syntax and imports in `app.py` and `flask-server/routes/`
- **Database schema changes**: Run `docker compose up` to apply new migrations (re-init on fresh volumes with `docker compose down -v`)
- **Stale test image**: `Dockerfile.test` copies the repo in at build time, so `docker compose run test` runs whatever was there when the image was last built. Rebuild after editing tests or `flask-server/`.
- **Rate limiting in tests**: `docker-compose.test.yml` sets `RATELIMIT_ENABLED=false` on both the `test` and the `flask` service, so no tier is throttled — the e2e tier crosses the network to Flask and used to be, despite this file claiming otherwise. `test/test_rate_limit.py` turns limiting back on in-process to cover it deliberately.

## After Code Changes

1. **Run `docker compose build`** to catch TypeScript and Python compile errors early
2. **Run full test suite**: `./run_tests.sh`
3. **Auth changes**: Always verify login/token-refresh flows end-to-end
4. **Flask decorators**: Verify exact syntax before proceeding

## Architecture

**Three-service Docker Compose app:**
- `mysql` — MySQL 8.0 on internal `backend` network
- `flask-server` — Flask 3.0 API on port 3000, `backend` network
- `next-version` — Next.js 16 frontend on port 5000, `frontend` network (also bridges to `backend`)

### Request flow
Browser → Next.js (`app/api/`) → Flask (`flask-server/routes/`) → MySQL

Next.js API routes are thin proxies: they attach credentials, handle cookie-based JWT token refresh (via `lib/flask-client.ts`), and forward to Flask. They do **not** validate payloads — all business logic and validation lives in Flask. Tests for this layer belong in `next-version/__tests__/`, and should assert forwarding and credential handling, not validation.

### Authentication
- Flask issues JWT access tokens + refresh tokens stored in httpOnly cookies
- `lib/flask-client.ts` (`fetchWithTokenRefresh`) transparently refreshes expired access tokens before retrying requests
- Flask endpoints are protected with `@jwt_required()` decorator

### Rate limiting
Keyed per caller, not per connection — see `flask-server/rate_limit.py` for why the stock `get_remote_address` cannot be used here (every browser request reaches Flask from the one Next.js container, so it returned the same value for every user).

- Authenticated requests key on the JWT identity, so the default 20/minute is per account
- Anonymous requests key on the client address; the proxy relays `X-Forwarded-For` under `INTERNAL_PROXY_SECRET` and Flask honours it only with that secret. In the current topology the browser reaches the Next.js container directly, so there is usually no address to relay — this matters once a reverse proxy sits in front
- `/login` guessing is throttled per account **inside the view**, after the password is known to be wrong. A `@limiter.limit(deduct_when=...)` decorator cannot express this: the check runs before the view, so an emptied bucket would refuse the account owner's correct password too

### Key files
- `flask-server/app.py` — application core (~300 lines): Flask instance, config, JWT manager and loaders, limiter, connection pool, boot-time migrations, blueprint registration
- `flask-server/routes/` — one blueprint per domain (`auth`, `categories`, `entries`, `finance`, `health`, `pomodoro`, `settings`, `todo`). These reach shared state via `import app` and call `app.get_cursor()` — resolved at call time, which is what keeps `patch("app.get_cursor")` working in the 42 tests that use it. Do not change these to `from app import get_cursor`: the patches would silently stop applying and several tests would pass against the real database
- `flask-server/rate_limit.py` — rate-limit keying and the failed-login throttle
- `flask-server/query_params.py` — shared parsing/SQL for `?from=&to=&category=&q=&sort=&direction=&limit=&offset=`
- `next-version/lib/types.ts` — TypeScript interfaces shared across the frontend (`User`, `TimeEntry`, `FinanceEntry`, `Category`, etc.)
- `next-version/lib/constants.ts` — API endpoint constants
- `next-version/lib/flask-client.ts` — `fetchWithTokenRefresh` utility used by all authenticated API routes
- `next-version/lib/proxy-headers.ts` — relays the caller's address to Flask under the shared secret
- `mysql/schema.sql` — 10 tables; forward-only migrations live in `flask-server/migrations/`

### Frontend structure
- `app/(main)/` — public-facing portfolio pages (home, CV)
- `app/namu/` — authenticated time management app
  - `user/entries/` — time tracking
  - `user/finance/` — expense tracking
  - `user/todo/` — todo management (tags, recurrence, bulk actions)
  - `user/timer/` — stopwatch (start/stop time tracking, manual entry)
  - `user/pomodoro/` — Pomodoro focus timer
  - `user/csv/` — CSV batch import
- `app/api/` — Next.js API routes proxying to Flask
- `components/` — shared UI components (`BatchImportModal`, `BatchGenerateModal`, `ImageCarousel`, `LogoutButton`)
- `__tests__/` — Vitest suite for the route handlers and server-side helpers
- `e2e/` — Playwright specs (local only)

### Theming
`app/globals.css` is the single source of theme truth. It redefines Tailwind v4's `dark:` variant to follow `[data-theme]` rather than the OS, so never introduce raw `gray-*`/`neutral-*` pairs to work around it. Note that in dark mode `surface-raised`, `surface-inset` and `surface-muted` all resolve to neutral-800 — if one surface must read as raised above another, check both themes; `surface-hover` (neutral-700) is the only reliable dark lift.

## Important notes

- **Before suggesting a commit**, always run the full test suite (`./run_tests.sh`) and confirm all tests pass. Do not consider work done until tests are green. This rebuilds all Docker services and runs every test tier (unit, integration, e2e) inside Docker where all dependencies are available.
- **Never add Claude as a co-author** in commit messages. The user owns all features and the technical debt they may entail.
- **Never open a PR (`gh pr create`) without being explicitly told to.** Commit and push the branch as usual, but stop there and wait for the user to say when to stage the PR.
- Environment variables come from `.env` (copy from `env.example.txt`); `JWT_SECRET_KEY` must be ≥64 chars, and `INTERNAL_PROXY_SECRET` should be a long random string (empty disables address forwarding).
- See `test/README.md` for detailed test documentation and `README.md` for the endpoint reference.
