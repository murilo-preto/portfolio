# Portfolio

A personal portfolio website built with Next.js, Flask, and MySQL, containerized with Docker.
Also features Namu, the time management app.

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS, Framer Motion
- **Backend**: Flask (Python)
- **Database**: MySQL 8.0
- **Deployment**: Docker Compose

## Project Structure

```
portfolio/
├── docker-compose.yml    # Orchestrates all services
├── .env                  # Environment variables
├── next-version/         # Next.js frontend
│   ├── app/              # App router pages
│   ├── components/      # React components
│   └── public/           # Static assets
├── flask-server/         # Flask API server
├── mysql/
│   └── schema.sql        # Database schema
```

## Getting Started

### Prerequisites

- Docker
- Docker Compose

### Configuration

Copy `.env.example.txt` to `.env` and configure:

```bash
cp env.example.txt .env
```

Edit `.env` with your database credentials.

### Running

```bash
docker compose up --build
```

### Stopping

```bash
docker compose down -v
```
