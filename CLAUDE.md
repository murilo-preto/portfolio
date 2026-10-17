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
One command covers all three standalone tiers and the full-stack one:

```bash
./run_tests.sh
```

It runs the Next.js route tests first (Vitest; mocks `fetch`, so it needs
neither MySQL nor Flask and reports in seconds), then the Namu Android app's
typecheck and Jest suite (`mobile-test`, equally standalone), then the Python
suite — unit, integration, e2e — against the full stack. Expect **945 Python
tests, 94 frontend tests and 86 mobile tests, with no skips**; anything
skipping is a real problem.

To run one tier on its own while iterating:

```bash
# Frontend only
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm nextjs-test

# Mobile app only (typecheck + Jest)
docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm mobile-test

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

### Android app (`mobile/`)
```bash
./mobile/build_apk.sh --lan    # LAN test APK, debug key, into mobile/dist/
./mobile/build_apk.sh          # release APK; needs the key from scripts/create_keystore.sh
./mobile/e2e/run.sh            # LAN APK on a headless emulator, against a fresh stack
```

Both builds run the mobile tests first. The first build takes several minutes
(SDK, NDK and a native compile); Gradle's cache is a BuildKit cache mount, so
later ones are quicker. `e2e/run.sh` is outside `run_tests.sh` for the same
reason Playwright is: it needs `/dev/kvm` and takes minutes. It runs its own
compose project (`namu-e2e`) with no published ports, so it can run beside a
dev stack. Screenshots, Maestro's per-flow logs and logcat land in
`mobile/e2e/output/` (ignored by git).

- **`sdkmanager` is pinned to cmdline-tools 22.0** (`mobile/Dockerfile`). 23.0
  replaces it with a shim that downloads an unpinned "Android CLI" during the
  build. Don't bump past 22.0 without checking that
- **Maestro flows must wait for enabled buttons.** The status screen checks in
  as it opens and disables its buttons until that returns, and Maestro taps a
  disabled button without complaint. Wait with `extendedWaitUntil` on
  `enabled: true` before tapping
- **Maestro's `http.post` refuses an empty body.** A script calling a bodiless
  POST route must send `{}`
- **Geofencing needs "Google Location Accuracy" on,** and the emulator image
  ships with it off. While it is off, Play services' geofencer stays in
  `DisabledState` and refuses every geofence the app adds. Nothing fires,
  and nothing reports an error. To check, look at `GeofencerStateMachine` in
  `adb shell dumpsys activity service
  com.google.android.gms/com.google.android.location.internal.GoogleLocationManagerService`.
  It's a Play services screen, not a system setting, so `run-flows.sh` taps
  the switch from a UI dump. It checks the switch itself and then the fused
  provider: `dumpsys location`'s "enabled=true" can belong to the GPS
  provider instead
- **Tear down `namu-e2e` after any manual run.** `run.sh` reuses a running
  emulator container, and that container's mount of `mobile/e2e/output/`
  points at the directory `run.sh` has just deleted. Maestro then fails with
  "Could not determine current working directory"
- **adb sometimes drops the emulator** ("device offline") as a flow clears
  and relaunches the app. `run-flows.sh` retries a flow once for that error
  only

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
- `flask-server/routes/` — one blueprint per domain (`auth`, `categories`, `devices`, `entries`, `finance`, `health`, `places`, `pomodoro`, `presence`, `settings`, `todo`). These reach shared state via `import app` and call `app.get_cursor()` — resolved at call time, which is what keeps `patch("app.get_cursor")` working in the 42 tests that use it. Do not change these to `from app import get_cursor`: the patches would silently stop applying and several tests would pass against the real database
- `flask-server/rate_limit.py` — rate-limit keying and the failed-login throttle
- `flask-server/presence.py` — the Panopto state machine: geofence events to stays to time entries, plus the 5-minute settling sweep. Takes a cursor and an injectable `now`, and never imports `app`
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
There is no web UI for devices yet (phase 5).

Phase 2b (the app, pairing only) is done: the Expo app in `mobile/`, with a
pair screen and a status screen, built into a sideloadable APK in Docker (see
**Android app**). It is tested in three tiers: Jest in `run_tests.sh`, the APK
build, and five Maestro flows on an emulator against the real stack (wrong
password, pair, pairing survives a restart, unpair, revoked from the web). It
has not yet been installed on a real phone.

Phase 3 (places) is done: `routes/places.py` (`/places` CRUD under the JWT, and
`/devices/me/places` for the phone), proxied at `/api/places`,
`/api/places/[id]` and `/api/devices/me/places`. The web page is
`/namu/user/places`, in the Time menu. The app's status screen lists the
enabled places, read-only, and a sixth Maestro flow covers it.
`category_admin` counts places as usage and moves them on reassign and merge.

Phase 4 (tracking) is done:
- **The app** geofences the enabled places through expo-location and
  expo-task-manager (`mobile/src/geofencing.ts`). Each crossing is queued in
  AsyncStorage (`src/queue.ts`) and sent by `src/sync.ts`. The status screen
  has a Tracking card with start/stop, the current stay and the queue length.
  Tracking needs "Allow all the time" location
- **Flask** takes them at `POST /devices/me/events` (`routes/presence.py`).
  `presence.py` turns events into stays and finished stays into time entries,
  and a 5-minute background sweep settles stays that time alone has decided.
  Migration 012 adds `presence_sessions.ended_at`, a departure waiting out the
  re-entry window. Next.js proxies `/api/devices/me/events` and
  `/api/devices/me/stay`
- **Tests:** a seventh Maestro flow, `07_geofence_stay`, moves the emulator
  into Office and out again, then checks that the time entry was written. All
  seven flows pass in the full suite

Phase 5 (the web side) is done:
- **Flask** serves the stay to the browser too, under the JWT
  (`routes/presence.py`): `GET /presence/stay` settles and then reads it, the
  same way the phone's route does. `POST /presence/stay/end` ends it early
  through `presence.end_stay`, which pausing a place also uses.
  `GET /presence/events?limit=` lists the recent events, 20 by default and
  100 at most. The phone list and revoke were already there from phase 2a
- **Next.js** proxies them at `/api/presence/stay`, `/api/presence/stay/end`
  and `/api/presence/events`, plus `/api/devices` and
  `/api/devices/[id]/revoke`. The page is `/namu/user/devices` ("Namu app" in
  the Time menu), with the current stay, the phones and the recent events. The
  Dashboard shows the same `StayBanner` (`components/presence/`) while a stay
  is open

Nothing else in this section exists as code yet. Update it as phases land, and
don't let it claim more than the code does.

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
- **Places are created on the web, without a map.** Coordinates are typed in,
  or filled by a "Use my current location" button (the browser's geolocation,
  read once). There's no map because tile requests would tell a third-party
  tile server roughly where each place is. An OpenStreetMap link checks the spot
- **The phone reads places, never writes them.** `GET /devices/me/places`
  returns the enabled ones only, which are what it will geofence
- **Places count as category usage,** like entries. A category a place uses
  can't be deleted without `reassign_to`, and merge and reassign move places
  with the entries
- **Deleting a place deletes its history** (the schema's cascade). Pausing it
  (`enabled = false`) is the way to stop watching it and keep the history
- **At most 100 places per user,** Android's per-app geofence limit. The cap
  is on all places, not just enabled ones
- **Stay rules** (`presence.py`; each overridable by env for tests):
  - **Re-entry window, 10 min** (`PRESENCE_REENTRY_SECONDS`): leaving and
    coming back within it counts as one stay. That absorbs jitter at the
    geofence's edge
  - **Minimum stay, 5 min** (`PRESENCE_MIN_STAY_SECONDS`): a shorter stay,
    such as passing through, logs nothing
  - **Cap, 16 h** (`PRESENCE_MAX_STAY_SECONDS`): a stay with no exit is closed
    at 16 h. The cap applies however the stay ends
- **Entry notes:** a stay's entry is noted "Namu: <place>". A capped one adds
  "(closed automatically, no departure after 16 h)"
- **Pausing a place ends its stay and logs it.** Deleting a place discards its
  stay unlogged. An enter for a paused place is recorded but opens nothing
- **A late enter is ignored if an earlier request already reported leaving
  that place after it.** Otherwise a straggler from the queue would open a
  stay that never sees its exit and runs to the 16 h cap
- **The phone stamps an event when its background task runs,** not at the
  exact crossing. Android can run the task a little late
- **Geofences have no foreground service, and survive reboots.** Geofencing
  goes through Play services' geofence alerts, so it doesn't need one. The
  app holds `RECEIVE_BOOT_COMPLETED`, so expo-task-manager re-registers its
  geofences after a reboot
- **A stay can be ended from the web,** for a phone that will never report
  leaving. An open stay ends now, and one that has already departed ends at
  the departure. The minimum stay and the cap still apply. The phone isn't
  told, so its later exit finds no stay and changes nothing
- **The stay is shown on the devices page and, while one is open, on the
  Dashboard.** If loading it fails, the Dashboard hides the banner rather than
  showing an error card
- **The web lists recent events read-only.** It shows the place, the phone,
  when the event happened, and how late it arrived when the phone queued it.
  There's no way to delete history from the web yet
- **Revoked phones stay listed, greyed out.** They can't be deleted or
  reinstated. Re-pairing creates a new row. Phones can't be renamed from the
  web

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
- **Anything that reads the stay must call `presence.settle` first,** as
  both stay routes do. Otherwise it can show a stay that time has already
  ended
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
