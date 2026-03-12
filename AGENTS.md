# Agent Guidelines

## Building and Testing Changes

**Always run `docker compose build` after making code changes** to ensure everything compiles and works correctly before considering a task complete.

```bash
docker compose build
```

This command will:

- Build the Flask backend and verify Python code compiles
- Build the Next.js frontend and run TypeScript type-checking
- Catch any build errors early before deployment

## Test Suite

A comprehensive test suite is available to verify functionality after agent calls and catch problems before deployment.

### Running Tests

```bash
# Make test runner executable (first time only)
chmod +x run_tests.sh

# Run unit tests (fast, no dependencies)
./run_tests.sh

# Run all tests (requires running services for E2E)
./run_tests.sh --all

# Run with coverage report
./run_tests.sh --all --coverage
```

### Test Types

| Command | Description | Requirements |
|---------|-------------|--------------|
| `./run_tests.sh` | Unit tests only | None |
| `./run_tests.sh -i` | Integration tests | MySQL database |
| `./run_tests.sh -e` | E2E tests | Running services |
| `./run_tests.sh -d` | Docker tests | Docker running |
| `./run_tests.sh -a` | All tests | Full stack |

### Individual Test Suites

```bash
# Flask unit tests
pytest test/test_flask_app.py -v

# Integration tests (requires DB)
RUN_INTEGRATION_TESTS=true pytest test/test_flask_integration.py -v

# E2E tests (requires services)
RUN_E2E_TESTS=true pytest test/test_e2e_health.py -v

# Docker verification
RUN_DOCKER_TESTS=true pytest test/test_docker_deployment.py -v

# Next.js tests
cd next-version && npx vitest run ../test/test_nextjs_api.test.ts
```

## Verifying the Build

After a successful build, verify the services are working:

```bash
# Start services
docker compose up -d

# Wait for services to be healthy
sleep 30

# Check health endpoints
curl http://localhost:3000/health
curl http://localhost:5000/api/health

# Run full test suite
./run_tests.sh --all
```

## Pre-Deployment Checklist

Before considering a task complete:

1. **Build**: `docker compose build`
2. **Unit Tests**: `./run_tests.sh`
3. **Start Services**: `docker compose up -d`
4. **E2E Tests**: `RUN_E2E_TESTS=true ./run_tests.sh -e`
5. **Verify Health**: All endpoints return 200

## Common Build Issues

- **Next.js TypeScript errors**: Fix type mismatches in `.tsx` files
- **Flask errors**: Check Python syntax and imports in `app.py`
- **Database schema changes**: Run `docker compose up` to apply new migrations
- **Rate limiting in tests**: Some tests may be skipped due to rate limiting (use integration tests instead)

## After Agent Calls

After using an agent to make changes:

1. **Run unit tests** to catch basic issues:
   ```bash
   ./run_tests.sh
   ```

2. **Build containers** to verify compilation:
   ```bash
   docker compose build
   ```

3. **Run E2E tests** if services are running:
   ```bash
   RUN_E2E_TESTS=true ./run_tests.sh -e
   ```

After modifying authentication-related files (JWT, tokens, sessions, cookies), always verify the auth flow works end-to-end before considering the task complete.

When working with Flask decorators or complex syntax, verify the exact syntax pattern works before proceeding with implementation.

## Test Coverage

The test suite covers:

- **Health endpoints** (Flask & Next.js)
- **Authentication** (register, login, JWT validation)
- **Input validation** (missing fields, format errors)
- **Database operations** (CRUD, transactions)
- **API integration** (Flask ↔ Next.js)
- **Docker configuration** (networks, volumes, health checks)

See `test/README.md` for detailed test documentation.
