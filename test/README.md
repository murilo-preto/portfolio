# Portfolio Test Suite

Comprehensive test suite for the Portfolio time-tracking application.

## Quick Start

```bash
# Make the test runner executable
chmod +x run_tests.sh

# Run unit tests (default)
./run_tests.sh

# Run all tests
./run_tests.sh --all

# Run with coverage
./run_tests.sh --all --coverage
```

## Test Structure

```
test/
├── conftest.py                 # Pytest configuration and fixtures
├── test_flask_app.py           # Flask backend unit tests
├── test_flask_integration.py   # Flask integration tests (requires DB)
├── test_nextjs_api.test.ts     # Next.js API route tests
├── test_e2e_health.py          # End-to-end health checks
└── test_docker_deployment.py   # Docker deployment verification
```

## Test Types

### 1. Unit Tests (`test_flask_app.py`)

Fast, isolated tests that don't require external services.

```bash
./run_tests.sh --unit
# or
pytest test/test_flask_app.py
```

**What's tested:**
- Health check endpoints
- Authentication (JWT)
- Input validation
- Error handling
- Route logic (mocked database)

### 2. Integration Tests (`test_flask_integration.py`)

Tests that interact with a real database.

```bash
# Enable integration tests
export RUN_INTEGRATION_TESTS=true
./run_tests.sh --integration
# or
RUN_INTEGRATION_TESTS=true pytest test/test_flask_integration.py
```

**What's tested:**
- Database connectivity
- User registration/login
- Category CRUD operations
- Time entry operations
- Batch imports

**Requirements:**
- MySQL database running
- Test database configured

### 3. Next.js API Tests (`test_nextjs_api.test.ts`)

Tests for Next.js API routes.

```bash
# Install Vitest (if not already installed)
cd next-version
npm install --save-dev vitest @vitest/ui

# Run tests
npx vitest run ../test/test_nextjs_api.test.ts
```

**What's tested:**
- API route handlers
- Request validation
- Error handling
- Authentication flow

### 4. End-to-End Tests (`test_e2e_health.py`)

Tests that verify the entire system is working together.

```bash
# Start services first
docker compose up -d

# Enable and run E2E tests
export RUN_E2E_TESTS=true
./run_tests.sh --e2e
# or
RUN_E2E_TESTS=true pytest test/test_e2e_health.py
```

**What's tested:**
- Service availability
- Health endpoints
- Full authentication flow
- API integration
- Rate limiting
- Service interdependencies

### 5. Docker Deployment Tests (`test_docker_deployment.py`)

Tests that verify Docker configuration and running containers.

```bash
# Enable and run Docker tests
export RUN_DOCKER_TESTS=true
./run_tests.sh --docker
# or
RUN_DOCKER_TESTS=true pytest test/test_docker_deployment.py
```

**What's tested:**
- Docker Compose configuration
- Container health
- Network configuration
- Volume mounts
- Environment variables
- Container logs

## Test Runner Options

| Option | Description |
|--------|-------------|
| `-u, --unit` | Run unit tests only (default) |
| `-i, --integration` | Run integration tests (requires database) |
| `-e, --e2e` | Run end-to-end tests (requires running services) |
| `-d, --docker` | Run Docker deployment tests |
| `-a, --all` | Run all tests |
| `-c, --coverage` | Generate coverage report |
| `-f, --file FILE` | Run specific test file |
| `-q, --quiet` | Quiet mode (minimal output) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUN_INTEGRATION_TESTS` | `false` | Enable integration tests |
| `RUN_E2E_TESTS` | `false` | Enable E2E tests |
| `RUN_DOCKER_TESTS` | `false` | Enable Docker tests |
| `FLASK_URL` | `http://localhost:3000` | Flask service URL |
| `NEXTJS_URL` | `http://localhost:5000` | Next.js service URL |
| `TEST_DB_HOST` | `localhost` | Test database host |
| `TEST_DB_PORT` | `3306` | Test database port |
| `TEST_DB_USER` | `test_user` | Test database user |
| `TEST_DB_PASSWORD` | `test_password` | Test database password |
| `TEST_DB_NAME` | `test_time_tracker` | Test database name |
| `SERVICE_TIMEOUT` | `30` | Service availability timeout (seconds) |

## Pre-Deployment Checklist

Before deploying, run this complete test sequence:

```bash
# 1. Run unit tests
./run_tests.sh --unit

# 2. Build and start services
docker compose build
docker compose up -d

# 3. Wait for services to be healthy
sleep 30

# 4. Run all tests
./run_tests.sh --all --coverage

# 5. Check test results
# - All tests should pass
# - Coverage should be > 80%
# - No critical errors in logs
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: test_time_tracker
        ports:
          - 3306:3306
        options: --health-cmd="mysqladmin ping" --health-interval=10s
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          pip install -r flask-server/requirements.txt
          pip install -r test-requirements.txt
      
      - name: Run unit tests
        run: pytest test/test_flask_app.py -v
      
      - name: Run integration tests
        env:
          RUN_INTEGRATION_TESTS: true
          TEST_DB_HOST: localhost
          TEST_DB_USER: root
          TEST_DB_PASSWORD: root
          TEST_DB_NAME: test_time_tracker
        run: pytest test/test_flask_integration.py -v
```

## Troubleshooting

### Integration Tests Fail

1. Ensure MySQL is running
2. Check database credentials in environment variables
3. Verify test database exists:
   ```sql
   CREATE DATABASE IF NOT EXISTS test_time_tracker;
   ```

### E2E Tests Fail

1. Start all services: `docker compose up -d`
2. Wait for services to be healthy: `docker compose ps`
3. Check service logs: `docker compose logs`

### Docker Tests Fail

1. Ensure Docker is running
2. Build images: `docker compose build`
3. Start containers: `docker compose up -d`

### Next.js Tests Fail

1. Install dependencies: `cd next-version && npm install`
2. Install Vitest: `npm install --save-dev vitest`
3. Run tests: `npx vitest run`

## Coverage Reports

Generate HTML coverage report:

```bash
./run_tests.sh --all --coverage
```

Open the report in your browser:

```bash
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

## Best Practices

1. **Run unit tests frequently** - They're fast and catch most bugs
2. **Run integration tests before commits** - Ensure database operations work
3. **Run E2E tests before deployments** - Verify entire system
4. **Keep tests isolated** - Each test should be independent
5. **Use descriptive test names** - Explain what and why
6. **Mock external services** - Keep tests fast and reliable
7. **Clean up test data** - Use transactions or cleanup fixtures

## Adding New Tests

### Unit Test Example

```python
def test_my_feature(client):
    """Test that my feature works correctly."""
    response = client.get("/my-endpoint")
    assert response.status_code == 200
    assert response.json()["result"] == "expected"
```

### Integration Test Example

```python
@pytest.mark.integration
def test_my_database_operation(client):
    """Test database operation with real DB."""
    response = client.post("/create", json={"data": "value"})
    assert response.status_code == 201
    
    # Verify in database
    response = client.get("/get")
    assert response.json()["data"] == "value"
```

### E2E Test Example

```python
@pytest.mark.e2e
def test_full_user_journey():
    """Test complete user journey."""
    # Register
    requests.post(f"{FLASK_URL}/register", json={...})
    
    # Login
    token = requests.post(f"{FLASK_URL}/login", json={...}).json()["access_token"]
    
    # Use authenticated endpoint
    response = requests.get(
        f"{FLASK_URL}/protected",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review test logs for specific errors
3. Ensure all prerequisites are met
4. Verify environment variables are set correctly
