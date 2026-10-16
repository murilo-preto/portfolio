# Portfolio

[![Tests](https://github.com/murilo-preto/portfolio/actions/workflows/tests.yml/badge.svg)](https://github.com/murilo-preto/portfolio/actions/workflows/tests.yml)

A personal portfolio and **Namu** — a full-featured time management app built with Next.js, Flask, and MySQL, containerized with Docker.

## Features

| Feature              | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| **Time Tracking**    | Log, categorize, and visualize time entries with interactive charts (Recharts) |
| **Pomodoro Timer**   | 25-minute focus sessions integrated with TODO items                            |
| **Finance Tracking** | Expense management                                                          |
| **TODO Manager**     | Full CRUD with priority/status badges and Pomodoro integration                 |
| **CSV Batch Import** | Import time and finance entries in bulk                                        |
| **Dashboard**        | Weekly calendar views, category charts (bar/pie), quick stats                  |
| **Authentication**   | JWT-based auth with httpOnly cookies and transparent token refresh             |
| **Image Gallery**    | Personal photo carousel (Embla)                                                |
| **CV Page**          | Professional resume with image carousel                                        |

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Framer Motion, Recharts, Lucide Icons, Embla Carousel
- **Backend**: Flask 3.0, Python 3.12, Gunicorn
- **Database**: MySQL 8.0
- **Auth**: JWT (Flask-JWT-Extended) with httpOnly cookie storage and auto-refresh
- **Infrastructure**: Docker Compose, GitHub Actions CI
- **Mobile** (`Panopto` branch): Expo / React Native Android app, built into a sideloaded APK in Docker
- **Testing**: Pytest (unit/integration/e2e), Vitest (Next.js route handlers) and Jest (Android app), all inside Docker via one command; Playwright and Maestro (Android emulator) for driven specs, run locally

## Architecture

```
Browser ──> Next.js (port 5000) ──> Flask API (port 3000) ──> MySQL 8.0
```

Next.js API routes act as thin proxies: they attach credentials, handle cookie-based JWT token refresh via `lib/flask-client.ts`, and forward all requests to Flask. Business logic and validation live in Flask, where routes are split into one blueprint per domain under `flask-server/routes/`. The app runs three Docker services (`mysql`, `flask`, `nextjs`) across two internal networks.

## API Endpoints

All 62 routes Flask serves. Four are unauthenticated — `/health`, `/register`,
`/login` and `/devices/pair`. The Namu app's `/devices/me*` routes take a device
token instead, and the rest need a JWT, which the Next.js proxy attaches from
the httpOnly cookie.

The four category and tag listings used to be public as well. They read lookup
tables that were global — one row per name for the whole installation — so an
anonymous caller on Flask's published port could enumerate every user's
category and tag names, finance categories included, which
`/finance/parse-itau-pdf` fills verbatim from bank statement PDFs. Migrations
004-007 gave those tables a `user_id`, and each listing now returns only the
caller's own rows.

### Health & Auth

| Method | Route       | Auth | Description                                        |
| ------ | ----------- | ---- | -------------------------------------------------- |
| GET    | `/health`   | No   | Health check                                       |
| GET    | `/protected`| JWT  | Token validity probe                               |
| POST   | `/register` | No   | Register user (bcrypt hashing)                     |
| POST   | `/login`    | No   | Login, receive JWT access token                    |

### Devices (Namu Android app)

A phone pairs once with a password, then authenticates with its device token
as `Authorization: Device <token>`.

| Method | Route                   | Auth   | Description                                         |
| ------ | ----------------------- | ------ | --------------------------------------------------- |
| POST   | `/devices/pair`         | No     | Pair a phone with username + password; returns the token once |
| GET    | `/devices/me`           | Device | The pairing this token belongs to; records it was seen |
| POST   | `/devices/me/revoke`    | Device | Unpair from the phone                               |
| GET    | `/devices`              | JWT    | The caller's paired phones, revoked ones included   |
| POST   | `/devices/<id>/revoke`  | JWT    | Revoke one of the caller's phones                   |

### Places (Namu Android app)

The pins the phone geofences. Each one logs its stays in one of the caller's
time categories, so deleting or merging a category moves its places along with
its entries (see `category_admin.py`).

| Method | Route                 | Auth   | Description                                          |
| ------ | --------------------- | ------ | ---------------------------------------------------- |
| GET    | `/places`             | JWT    | The caller's places, disabled ones included          |
| POST   | `/places`             | JWT    | Create a place: name, category, coordinates, radius 100-2000 m; at most 100 per user |
| PATCH  | `/places/<id>`        | JWT    | Change any of its fields                             |
| DELETE | `/places/<id>`        | JWT    | Delete it, with its recorded events and any open stay |
| GET    | `/devices/me/places`  | Device | The enabled places, i.e. the ones the phone watches  |

### Presence (Namu Android app)

The phone reports raw geofence crossings; Flask turns them into stays and, when
a stay ends, into an ordinary time entry in the place's category. The rules
(re-entry window, minimum stay, 16 h cap) are in `flask-server/presence.py`.

| Method | Route                 | Auth   | Description                                          |
| ------ | --------------------- | ------ | ---------------------------------------------------- |
| POST   | `/devices/me/events`  | Device | Up to 100 enter/exit events; answers each as accepted, duplicate or rejected, plus the current stay and enabled places |
| GET    | `/devices/me/stay`    | Device | The stay in progress, if any                         |

### Account

| Method | Route               | Auth | Description                                  |
| ------ | ------------------- | ---- | -------------------------------------------- |
| POST   | `/user/password`    | JWT  | Change password (current password required)  |
| GET    | `/user/preferences` | JWT  | Read theme, currency and the client settings blob |
| PUT    | `/user/preferences` | JWT  | Update preferences                           |

### Time Entries

| Method | Route                 | Auth | Description                                        |
| ------ | --------------------- | ---- | -------------------------------------------------- |
| GET    | `/entry`              | JWT  | List entries; supports the list query parameters below |
| POST   | `/entry/create`       | JWT  | Create entry (ISO 8601 with timezone)              |
| PUT    | `/entry/<id>`         | JWT  | Update entry (ownership verified)                  |
| DELETE | `/entry/delete`       | JWT  | Delete entry                                       |
| POST   | `/entry/batch-import` | JWT  | Batch import entries                               |

### Finance

| Method | Route                        | Auth | Description                                     |
| ------ | ---------------------------- | ---- | ----------------------------------------------- |
| GET    | `/finance`                   | JWT  | List finance entries; supports list query parameters |
| POST   | `/finance/create`            | JWT  | Create finance entry                            |
| PUT    | `/finance/<id>`              | JWT  | Update entry                                    |
| POST   | `/finance/delete`            | JWT  | Delete entry                                    |
| POST   | `/finance/bulk-delete`       | JWT  | Delete up to 500 entries by id                  |
| POST   | `/finance/batch-import`      | JWT  | Batch import                                    |
| POST   | `/finance/batch-generate`    | JWT  | Generate planned entries from a frequency + day-of-month schedule |
| POST   | `/finance/parse-itau-pdf`    | JWT  | Extract entries from Itaú statement PDFs        |

### TODO

| Method | Route                | Auth | Description                                   |
| ------ | -------------------- | ---- | --------------------------------------------- |
| GET    | `/todo`              | JWT  | List items; adds `status` and `priority` filters |
| POST   | `/todo/create`       | JWT  | Create item                                   |
| PUT    | `/todo/<id>`         | JWT  | Update item (completing a recurring one spawns the next) |
| POST   | `/todo/delete`       | JWT  | Delete item                                   |
| POST   | `/todo/bulk-update`  | JWT  | Bulk status update                            |
| GET    | `/todo/tags`         | JWT  | List your tags                                |
| POST   | `/todo/tag`          | JWT  | Create tag                                    |

### Categories

Three independent namespaces — time, finance and todo — with the same shape.
Each is scoped to its owner: names are unique per `(user_id, name)`, so two
accounts can both have a "Work" category without sharing a row, and one user's
categories are invisible to another.

| Method | Route                                  | Auth | Description                    |
| ------ | -------------------------------------- | ---- | ------------------------------ |
| GET    | `/get/categories`                      | JWT  | List your time categories      |
| GET    | `/finance/categories`                  | JWT  | List your finance categories   |
| GET    | `/todo/categories`                     | JWT  | List your todo categories      |
| POST   | `/category`, `/finance/category`, `/todo/category` | JWT | Create           |
| GET    | `/…/category/usage`                    | JWT  | Entry count per category       |
| PUT    | `/…/category/<id>`                     | JWT  | Rename                         |
| DELETE | `/…/category/<id>`                     | JWT  | Delete                         |
| POST   | `/…/category/<id>/merge`               | JWT  | Merge into another category    |

### Pomodoro

| Method | Route                | Auth | Description                                        |
| ------ | -------------------- | ---- | -------------------------------------------------- |
| POST   | `/pomodoro/start`    | JWT  | Start focus session                                |
| POST   | `/pomodoro/complete` | JWT  | Complete session; optionally logs a time entry and advances the linked task |
| POST   | `/pomodoro/cancel`   | JWT  | Cancel session                                     |
| GET    | `/pomodoro/sessions` | JWT  | List sessions                                      |
| GET    | `/pomodoro/stats`    | JWT  | Session statistics                                 |

### List query parameters

`GET /entry`, `/finance` and `/todo` accept `from`, `to`, `category`, `q`,
`sort`, `direction`, `limit` and `offset`, applied in MySQL. `/todo` adds
`status` and `priority`. With none of them the response is every row in its
original order, unpaginated. A parameter that cannot be honoured is a 400, never
silently dropped. See `flask-server/query_params.py`.

## Project Structure

```
portfolio/
├── docker-compose.yml          # Three-service orchestration
├── docker-compose.test.yml     # Test runner service
├── .env.example.txt
├── next-version/               # Next.js frontend
│   ├── app/
│   │   ├── (main)/             # Public pages (home, cv, gallery, login, demo)
│   │   ├── namu/               # Authenticated app (entries, finance, todo, timer, csv)
│   │   └── api/                # API route proxies to Flask
│   ├── components/             # React components (entries, finance, timer, todo, shared)
│   ├── lib/                    # Types, constants, Flask client, proxy headers
│   ├── __tests__/              # Vitest suite for the route handlers
│   ├── e2e/                    # Playwright specs (local only)
│   └── public/                 # Static assets and images
├── flask-server/
│   ├── app.py                  # App core: config, JWT, limiter, pool, blueprint registration
│   ├── routes/                 # One blueprint per domain (auth, entries, finance, todo, …)
│   ├── rate_limit.py           # Rate-limit keying and the failed-login throttle
│   ├── query_params.py         # Shared filter/sort/page parsing for the list endpoints
│   ├── category_admin.py       # Namespace-agnostic rename/delete/merge
│   ├── finance_due.py          # Daily sweep completing planned finance entries
│   ├── itau_pdf.py             # Statement PDF extraction
│   ├── migrations/             # Forward-only schema migrations
│   └── requirements.txt
├── mobile/                     # Namu Android app (Expo); Dockerfile, build_apk.sh
│   ├── src/                    # Screens, API client, storage, and their Jest tests
│   └── e2e/                    # Emulator + Maestro flows (local only)
├── mysql/
│   └── schema.sql              # 10 tables (users, entries, categories, todo, pomodoro, …)
├── test/                       # Python tiers — unit, integration, e2e
│   ├── test_flask_app.py       # Unit tests, DB mocked
│   ├── test_flask_integration.py, test_security.py, test_e2e_health.py
│   ├── test_rate_limit.py      # Rate-limit keying (turns limiting on deliberately)
│   ├── test_categories.py, test_settings.py, test_task_time_link.py
│   ├── test_list_queries.py, test_query_params.py, test_migrations.py, test_finance_due.py
│   └── conftest.py
├── run_tests.sh                # Runs the frontend suite, then every Python tier
└── .github/workflows/tests.yml # CI: runs full suite on push/PR to main
```

## Getting Started

### Prerequisites

- Docker
- Docker Compose

### Configuration

```bash
cp env.example.txt .env
```

Edit `.env` with your database credentials. `JWT_SECRET_KEY` must be ≥64 characters, and `INTERNAL_PROXY_SECRET` should be a long random string — it is what lets Flask trust the caller address the Next.js proxy forwards, so rate limits apply per user rather than per container.

### Running

```bash
docker compose up --build
```

- Flask API: <http://localhost:3000>
- Next.js frontend: <http://localhost:5000>

### Public deployment (HTTPS)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The site is served by nginx on the host, which handles TLS and proxies to
Next.js. This overlay publishes Next.js on `127.0.0.1:5000` only and Flask not
at all, so the app is reachable only through nginx. It requires
`INTERNAL_PROXY_SECRET` in `.env`. `deploy/nginx-site.conf.example` is the
reference nginx site; its `X-Forwarded-For` line matters for rate limiting.

### Stopping

```bash
docker compose down -v
```

## Testing

One command runs everything inside Docker — no local Python, Node or MySQL
setup required:

```bash
./run_tests.sh
```

It runs the Next.js route tests first (Vitest; `fetch` is mocked, so it needs
neither MySQL nor Flask), then the Android app's Jest suite, then the Python
tiers against the full stack. Expect **916 Python tests, 75 frontend tests and
86 mobile tests, no skips**.

Browser-driven Playwright specs are separate — they need a browser download and
a running stack:

```bash
docker compose up --build          # in another terminal
cd next-version && npx playwright test
```

The Android app's emulator tests are separate too — they need `/dev/kvm`, and
bring up their own copy of the stack:

```bash
./mobile/build_apk.sh --lan    # optional: run.sh builds the LAN APK if missing
./mobile/e2e/run.sh
```

## Pre-Deployment Checklist

1. `docker compose build` — catches TypeScript/Python errors
2. `./run_tests.sh` — full suite green
3. Health endpoints return 200
