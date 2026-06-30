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

# Frontend lint
cd next-version && npm run lint

# Frontend tests (Vitest)
cd next-version && npx vitest run ../test/test_nextjs_api.test.ts
```

### Testing

All tests run inside Docker — no local Python or MySQL setup required:

```bash
# Full rebuild + all tests (unit, integration, e2e)
./run_tests.sh

# Next.js API tests (local dev only)
cd next-version && npx vitest run ../test/test_nextjs_api.test.ts
```

Covers: health endpoints, authentication (register, login, JWT), input validation, DB operations (CRUD, transactions), API integration (Flask ↔ Next.js), security (IDOR, SQLi, auth bypass, token manipulation).

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
- **Flask errors**: Check Python syntax and imports in `app.py`
- **Database schema changes**: Run `docker compose up` to apply new migrations (re-init on fresh volumes with `docker compose down -v`)
- **Rate limiting in tests**: Some tests may be skipped due to rate limiting; rate limiting is always disabled inside Docker (`RATELIMIT_ENABLED=false` is set by `docker-compose.test.yml`)

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
Browser → Next.js (`app/api/`) → Flask (`flask-server/app.py`) → MySQL

Next.js API routes are thin proxies: they handle cookie-based JWT token refresh (via `lib/flask-client.ts`) and forward requests to Flask. All business logic lives in Flask.

### Authentication
- Flask issues JWT access tokens + refresh tokens stored in httpOnly cookies
- `lib/flask-client.ts` (`fetchWithTokenRefresh`) transparently refreshes expired access tokens before retrying requests
- Flask endpoints are protected with `@jwt_required()` decorator; rate limiting via Flask-Limiter (stricter on `/register` and `/login`)

### Key files
- `flask-server/app.py` — entire Flask backend (~2500 lines); single file with all routes, DB queries, JWT config, and rate limiting
- `next-version/lib/types.ts` — TypeScript interfaces shared across the frontend (`User`, `TimeEntry`, `FinanceEntry`, `Category`, etc.)
- `next-version/lib/constants.ts` — API endpoint constants
- `next-version/lib/flask-client.ts` — `fetchWithTokenRefresh` utility used by all authenticated API routes
- `mysql/` — database schema SQL files

### Frontend structure
- `app/(main)/` — public-facing portfolio pages (home, CV)
- `app/namu/` — authenticated time management app
  - `user/entries/` — time tracking
  - `user/finance/` — expense tracking (+ `recurring/`)
  - `user/todo/` — todo management
  - `user/timer/` — Pomodoro timer
  - `user/csv/` — CSV batch import
- `app/api/` — Next.js API routes proxying to Flask
- `components/` — shared UI components (`BatchImportModal`, `ImageCarousel`, `LogoutButton`)

## Important notes

- **Before suggesting a commit**, always run the full test suite (`./run_tests.sh`) and confirm all tests pass. Do not consider work done until tests are green. This rebuilds all Docker services and runs every test tier (unit, integration, e2e) inside Docker where all dependencies are available.
- **Never add Claude as a co-author** in commit messages. The user owns all features and the technical debt they may entail.
- Environment variables come from `.env` (copy from `env.example.txt`); `JWT_SECRET_KEY` must be ≥64 chars.
- See `test/README.md` for detailed test documentation.
