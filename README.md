# Portfolio

[![Tests](https://github.com/murilo-preto/portfolio/actions/workflows/tests.yml/badge.svg)](https://github.com/murilo-preto/portfolio/actions/workflows/tests.yml)

A personal portfolio and **Namu** — a full-featured time management app built with Next.js, Flask, and MySQL, containerized with Docker.

## Features

| Feature              | Description                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| **Time Tracking**    | Log, categorize, and visualize time entries with interactive charts (Recharts) |
| **Pomodoro Timer**   | 25-minute focus sessions integrated with TODO items                            |
| **Finance Tracking** | Expense management with recurring expenses support                             |
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
- **Testing**: Pytest (unit/integration/e2e/docker), Vitest (Next.js API routes)

## Architecture

```
Browser ──> Next.js (port 5000) ──> Flask API (port 3000) ──> MySQL 8.0
```

Next.js API routes act as thin proxies: they handle cookie-based JWT token refresh via `lib/flask-client.ts` and forward all requests to Flask. Business logic lives in Flask. The app runs three Docker services (`mysql`, `flask-server`, `next-version`) across two internal networks.

## API Endpoints

### Health & Auth

| Method | Route       | Auth | Description                     |
| ------ | ----------- | ---- | ------------------------------- |
| GET    | `/health`   | No   | Health check                    |
| POST   | `/register` | No   | Register user (bcrypt hashing)  |
| POST   | `/login`    | No   | Login, receive JWT access token |

### Time Entries

| Method | Route                 | Auth | Description                           |
| ------ | --------------------- | ---- | ------------------------------------- |
| GET    | `/entry`              | JWT  | List user entries                     |
| POST   | `/entry/create`       | JWT  | Create entry (ISO 8601 with timezone) |
| PUT    | `/entry/<id>`         | JWT  | Update entry (ownership verified)     |
| DELETE | `/entry/delete`       | JWT  | Delete entry                          |
| POST   | `/entry/batch-import` | JWT  | Batch import entries                  |

### Finance

| Method | Route                        | Auth | Description               |
| ------ | ---------------------------- | ---- | ------------------------- |
| GET    | `/finance`                   | JWT  | List user finance entries |
| POST   | `/finance/create`            | JWT  | Create finance entry      |
| PUT    | `/finance/<id>`              | JWT  | Update entry              |
| POST   | `/finance/delete`            | JWT  | Delete entry              |
| POST   | `/finance/batch-import`      | JWT  | Batch import              |
| GET    | `/recurring-expenses`        | JWT  | List recurring expenses   |
| POST   | `/recurring-expenses/create` | JWT  | Create recurring expense  |

### TODO & Pomodoro

| Method | Route                | Auth | Description            |
| ------ | -------------------- | ---- | ---------------------- |
| GET    | `/todo`              | JWT  | List TODO items        |
| POST   | `/todo/create`       | JWT  | Create TODO item       |
| PUT    | `/todo/<id>`         | JWT  | Update TODO item       |
| POST   | `/todo/bulk-update`  | JWT  | Bulk status update     |
| POST   | `/pomodoro/start`    | JWT  | Start Pomodoro session |
| POST   | `/pomodoro/complete` | JWT  | Complete session       |
| GET    | `/pomodoro/stats`    | JWT  | Session statistics     |

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
│   ├── lib/                    # Types, constants, Flask client utility
│   └── public/                 # Static assets and images
├── flask-server/
│   ├── app.py                  # Single-file Flask API (~2500 lines)
│   └── requirements.txt
├── mysql/
│   └── schema.sql              # 9 tables (users, entries, categories, etc.)
├── test/
│   ├── test_flask_app.py       # Unit tests (349 lines)
│   ├── test_flask_integration.py # Integration tests (353 lines)
│   ├── test_security.py        # Security tests (1575 lines)
│   ├── test_nextjs_api.test.ts # Next.js API tests (529 lines)
│   ├── test_e2e_health.py      # E2E health tests (245 lines)
│   ├── test_docker_deployment.py # Docker tests (302 lines)
│   └── conftest.py
├── run_tests.sh                # Test runner with --unit, --integration, --e2e, --docker, --compose
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

Edit `.env` with your database credentials (JWT_SECRET_KEY must be ≥64 characters).

### Running

```bash
docker compose up --build
```

- Flask API: <http://localhost:3000>
- Next.js frontend: <http://localhost:5000>

### Stopping

```bash
docker compose down -v
```

## Testing

```bash
# Full rebuild + all tests inside Docker
./run_tests.sh

# Next.js API tests (local dev only)
cd next-version && npx vitest run ../test/test_nextjs_api.test.ts
```

## Pre-Deployment Checklist

1. `docker compose build` — catches TypeScript/Python errors
2. `./run_tests.sh` — full suite green
3. Health endpoints return 200
