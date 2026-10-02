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
integration, e2e — against the full stack. Expect **758 Python tests and 67
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

### Public deployment (HTTPS)
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl https://murilopreto.com.br/api/health
```

Production is `murilopreto.com.br`: nginx 1.22 on the host itself handles TLS
(certbot) and proxies to Next.js. `docker-compose.prod.yml` publishes Next.js
on `127.0.0.1:5000` only and Flask not at all. It requires
`INTERNAL_PROXY_SECRET` and sets `COOKIE_SECURE=true` (see
`lib/auth-cookie.ts`). `deploy/nginx-site.conf.example` is the reference site.
It must set `X-Forwarded-For` to `$remote_addr`, not
`$proxy_add_x_forwarded_for`, which would let a caller choose their own
rate-limit bucket. It must use 1.22 syntax (`listen 443 ssl http2`, not
`http2 on`). To try the overlay locally, give it its own project name (`-p`)
so it doesn't share the dev MySQL volume.

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
- The Namu Android app uses **device tokens** instead: paired once with a
  password at `/devices/pair`, then sent as `Authorization: Device <token>` and
  checked by `@device_required` (`routes/devices.py`). The scheme is `Device`,
  not `Bearer`, so `limiter_key` never tries to decode one as a JWT. Only the
  token's SHA-256 is stored. `/devices/pair` shares `/login`'s per-account
  failed-guess budget through `routes.auth.authenticate`

### Category and tag tables are per user

`category`, `finance_categories`, `todo_categories` and `todo_tags` each carry a
`user_id`, with `UNIQUE (user_id, name)`. They were global until migrations
004-007 — one row per name for the whole installation, and the four listing
endpoints served them with no token at all, so any caller who could reach
Flask's published port could enumerate every user's names.

Consequences worth knowing before writing a query against them:

- **Every read and write must carry a `user_id` predicate.** Resolving a
  category by name alone will attach one user's entry to another's row
- `category_admin.py`'s 409 "shared" branch is now unreachable by construction.
  It is kept as an invariant check, not an expected outcome; another user's
  category id is a 404, not a 409
- `user_id` carries **no** foreign key to `users`, deliberately. A cascade from
  `users` reaches both the lookup table and the entry table, InnoDB picks the
  order, and it takes the lookup table first — so the `ON DELETE RESTRICT` from
  the not-yet-deleted entries aborts the delete with errno 1451 and the account
  becomes undeletable. Measured, not assumed; `test_security.py` pins it. The
  cost is that lookup rows outlive their owner
- New accounts are seeded with defaults in `routes/auth.py`, in the same
  transaction as the user insert

### Rate limiting
Keyed per caller, not per connection — see `flask-server/rate_limit.py` for why the stock `get_remote_address` cannot be used here (every browser request reaches Flask from the one Next.js container, so it returned the same value for every user).

- Authenticated requests key on the JWT identity, so the default 20/minute is per account
- Device requests key on the hash of their device token, checked before the view without a DB lookup. A made-up token is therefore a fresh bucket, so every device route also carries an address-keyed cap (`DEVICE_ADDRESS_LIMIT` in `routes/devices.py`)
- Anonymous requests key on the client address; the proxy relays `X-Forwarded-For` under `INTERNAL_PROXY_SECRET` and Flask honours it only with that secret. In local development the browser reaches the Next.js container directly, so there is no address to relay. In production, nginx sets `X-Forwarded-For` to the connecting address (`deploy/nginx-site.conf.example`), so the relayed address is the real caller
- `/login` guessing is throttled per account **inside the view**, after the password is known to be wrong. A `@limiter.limit(deduct_when=...)` decorator cannot express this: the check runs before the view, so an emptied bucket would refuse the account owner's correct password too

### Key files
- `flask-server/app.py` — application core (~300 lines): Flask instance, config, JWT manager and loaders, limiter, connection pool, boot-time migrations, blueprint registration
- `flask-server/routes/` — one blueprint per domain (`auth`, `categories`, `devices`, `entries`, `finance`, `health`, `pomodoro`, `settings`, `todo`). These reach shared state via `import app` and call `app.get_cursor()` — resolved at call time, which is what keeps `patch("app.get_cursor")` working in the 42 tests that use it. Do not change these to `from app import get_cursor`: the patches would silently stop applying and several tests would pass against the real database
- `flask-server/rate_limit.py` — rate-limit keying and the failed-login throttle
- `flask-server/device_tokens.py` — device token generation, hashing and header parsing; no DB, so `rate_limit.py` can key on it
- `flask-server/users.py` — `resolve_user_id(cursor, username)`. The JWT carries
  a username, not an id, so anything touching a user-scoped table needs this
  first. Takes a cursor so the lookup shares the caller's transaction
- `flask-server/category_admin.py` — namespace-agnostic rename/delete/merge
- `flask-server/categories.py` — name normalizing, and the default categories
  seeded at registration. Those two lists must match what `mysql/schema.sql`
  seeds; a test asserts it, because the baseline is frozen and cannot follow
- `flask-server/query_params.py` — shared parsing/SQL for `?from=&to=&category=&q=&sort=&direction=&limit=&offset=`
- `next-version/lib/types.ts` — TypeScript interfaces shared across the frontend (`User`, `TimeEntry`, `FinanceEntry`, `Category`, etc.)
- `next-version/lib/constants.ts` — API endpoint constants
- `next-version/lib/flask-client.ts` — `fetchWithTokenRefresh` utility used by all authenticated API routes
- `next-version/lib/proxy-headers.ts` — relays the caller's address to Flask under the shared secret
- `next-version/lib/device-proxy.ts` — forwards the Android app's requests, passing its `Authorization: Device` header through untouched
- `mysql/schema.sql` — 10 tables; forward-only migrations live in `flask-server/migrations/` (008-011 add the four Panopto tables)

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
- `__tests__/` — Vitest suite for the route handlers, server-side helpers and DOM-free frontend logic (e.g. `calendarSelection.ts`)
- `e2e/` — Playwright specs (local only)

### Theming
`app/globals.css` is the single source of theme truth. It redefines Tailwind v4's `dark:` variant to follow `[data-theme]` rather than the OS, so never introduce raw `gray-*`/`neutral-*` pairs to work around it. Note that in dark mode `surface-raised`, `surface-inset` and `surface-muted` all resolve to neutral-800 — if one surface must read as raised above another, check both themes; `surface-hover` (neutral-700) is the only reliable dark lift.

## Important notes

- **Before suggesting a commit**, always run the full test suite (`./run_tests.sh`) and confirm all tests pass. Do not consider work done until tests are green. This rebuilds all Docker services and runs every test tier (unit, integration, e2e) inside Docker where all dependencies are available.
- **Never add Claude as a co-author** in commit messages. The user owns all features and the technical debt they may entail.
- **Never open a PR (`gh pr create`) without being explicitly told to.** Commit and push the branch as usual, but stop there and wait for the user to say when to stage the PR.
- Environment variables come from `.env` (copy from `env.example.txt`); `JWT_SECRET_KEY` must be ≥64 chars, and `INTERNAL_PROXY_SECRET` should be a long random string (empty disables address forwarding; the public deployment refuses to start without it).
- See `test/README.md` for detailed test documentation and `README.md` for the endpoint reference.

## Branch: Panopto (location-driven time entries)

Work in progress on the `Panopto` branch. Remove or fold this section into the
rest of the file when the branch merges.

### Goal
Detect a user's routine from location and populate time entries
automatically. For example, arriving at work starts counting, and leaving stops
it, with no manual stopwatch.

### Status
Phase 0 (public HTTPS) is in the repo: `docker-compose.prod.yml`, the Secure
cookie flag and `deploy/nginx-site.conf.example`, verified locally. It is **not
yet confirmed on the server**: the live nginx's `X-Forwarded-For` line, and
whether `INTERNAL_PROXY_SECRET` is set there, are unchecked, and the stack there
still runs without the overlay.

Phase 1 (schema) is done: migrations 008-011 create `places`, `devices`,
`presence_events` and `presence_sessions`, pinned by
`test/test_presence_schema.py`.

Phase 2a (pairing, server side) is done: `/devices/*` in Flask, proxied by
Next.js at `/api/devices/pair`, `/api/devices/me` and `/api/devices/me/revoke`.
There is no web UI for devices yet (phase 5). Next is phase 2b, the Expo app
and its Docker build. Nothing else in this section exists as code yet. Update
it as phases land, and don't let it claim more than the code does.

### Decisions
- **Event source: a companion Android app.** It's Expo (React Native +
  TypeScript) in `mobile/` and uses OS geofencing. No iOS support for now
- **Distribution: a sideloaded, self-signed release APK.** There's no Play
  Store. The signing keystore lives outside the repo and is never baked into an
  image. Losing it means updates won't install over the existing app
- **The APK builds in Docker** (`mobile/Dockerfile`), like the rest of the repo.
  There's no local JDK or Android SDK. `mobile/android/` is generated by
  `expo prebuild` and is not committed
- **Flask decides everything.** The app reports raw enter/exit events with their
  own timestamps and queues them while offline. Deduplication, re-entry within a
  few minutes, and capping an unclosed stay happen server-side
- **Application id: `dev.mpreto.namu`.** It's permanent: Android treats a
  different id as a different app. Don't use "Panopto" as the display name,
  since it's an existing commercial product. The branch name is fine
- **The phone reaches the server over public HTTPS.** Plain HTTP stays blocked
  in the app (Android's default). Only Next.js should be reachable from the
  internet, behind the host's nginx (see **Public deployment**). Flask must not
  be. The address relaying under `INTERNAL_PROXY_SECRET` (see **Rate
  limiting**) matters there, and the
  pairing endpoint, which takes a password, needs the same per-account throttle
  as `/login`
- **One open stay per person.** `presence_sessions` is `UNIQUE (user_id)`.
  Entering a second place while one is open closes the first at the moment the
  second starts
- **Event history is kept indefinitely** for now. It's the debugging trail and
  the raw material for routine learning. A retention job can come later
- **Place radius is 100-2000 m,** enforced by a CHECK. Android geofencing is
  unreliable below about 100 m
- **Device tokens never expire.** They are revoke-only, from the phone
  (`/devices/me/revoke`) or the web (`/devices/<id>/revoke`). A background app
  cannot log in again on its own, and keeping the password on the phone would
  be worse
- **App display name: "Namu".**
- **A second, LAN-only test APK.** `build_apk.sh --lan` builds
  `dev.mpreto.namu.lan`, which installs alongside the real app and allows plain
  HTTP to private network addresses only, for pairing with `docker compose up`
  on a laptop. The release APK stays HTTPS-only
- **Stays are logged automatically.** Leaving a place writes a normal
  `time_entries` row with no confirmation step. A stay closed by the server's
  cap rather than a real "leave" is still written, and is marked in the entry's
  `note` so it stands out for correction

### Constraints the current code imposes
- **A browser cannot geofence in the background.** A Next.js page only sees
  location while it is open and in front. Arrival and departure events must come
  from somewhere else: a PWA or mobile companion, an OS automation (iOS
  Shortcuts, Android Tasker) calling an endpoint, or a third-party location
  service's webhook. Settled in favour of a companion app (see **Decisions**)
- **The server has no notion of a running entry.** `time_entries.end_time` is
  `NOT NULL`, and the stopwatch (`app/namu/user/timer/page.tsx`) holds its
  running state only in `localStorage`, writing a finished entry via
  `/api/entry/create` or `/api/entry/batch-import` when stopped. A server-side
  "start counting" needs a new open-session concept, through a new table or a
  nullable `end_time`. The second option touches every query that assumes a
  closed interval
- **Events arrive without a browser session.** A geofence trigger won't carry
  the httpOnly JWT cookies, so it needs its own per-user credential (e.g. a
  revocable token per device). It must still resolve to a `user_id` through
  `users.resolve_user_id` and respect the per-user scoping rules above. It also
  needs to fit the per-caller rate-limit keying in `rate_limit.py`
- **Validation lives in Flask.** Any Next.js route added for this stays a thin
  proxy, and its tests assert forwarding, not validation
- **Schema changes are forward-only migrations.** Add `008_*.sql` onward in
  `flask-server/migrations/`, and never edit `mysql/schema.sql`'s frozen
  baseline

### Notes for later phases
- **Phase 3 must teach `category_admin` about places.** `places.category_id`
  is `ON DELETE RESTRICT`, but `delete` and `merge` only count and move
  entries. Until they also count and move places, deleting a category a place
  uses fails with errno 1451 and returns a 500.
  `test_a_category_used_by_a_place_cannot_be_deleted` pins the constraint
- **No RESTRICT on the users cascade path.** Every FK from the Panopto tables
  cascades or sets NULL, except `places.category_id`, and `category` is off
  that path. A new table must keep it that way, or accounts become undeletable
  (see **Category and tag tables are per user**).
  `test_deleting_a_user_removes_all_their_presence_data` pins it
- **Duplicate events are refused by the database.** Phase 4 should insert and
  treat errno 1062 on `uk_presence_events_client_id` as "already processed",
  not check first and race

### Privacy
Location history is sensitive. Store as little as the feature needs (e.g. "user
entered place X at time T", not raw coordinate trails). Scope every row to its
owner, and make sure deleting a place or an account deletes what was recorded
for it.

### Test counts
New tests change the expected totals in **Testing** above and in the
`run-tests-expected-count` memory. Update both in the same commit.
