#!/bin/bash
# Test runner script for the portfolio project
# Usage: ./run_tests.sh [options]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
RUN_UNIT=true
RUN_INTEGRATION=false
RUN_E2E=false
RUN_DOCKER=false
RUN_COVERAGE=false
TEST_FILE=""
VERBOSITY="-v"

# Print usage
usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -u, --unit          Run unit tests only (default)"
    echo "  -i, --integration   Run integration tests (requires database)"
    echo "  -e, --e2e           Run end-to-end tests (requires running services)"
    echo "  -d, --docker        Run Docker deployment tests"
    echo "  -a, --all           Run all tests"
    echo "  -c, --coverage      Generate coverage report"
    echo "  -f, --file FILE     Run specific test file"
    echo "  -q, --quiet         Quiet mode (minimal output)"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                          # Run unit tests"
    echo "  $0 --all                    # Run all tests"
    echo "  $0 -i -c                    # Run integration tests with coverage"
    echo "  $0 -f test_flask_app.py     # Run specific test file"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--unit)
            RUN_UNIT=true
            RUN_INTEGRATION=false
            RUN_E2E=false
            RUN_DOCKER=false
            shift
            ;;
        -i|--integration)
            RUN_INTEGRATION=true
            shift
            ;;
        -e|--e2e)
            RUN_E2E=true
            shift
            ;;
        -d|--docker)
            RUN_DOCKER=true
            shift
            ;;
        -a|--all)
            RUN_UNIT=true
            RUN_INTEGRATION=true
            RUN_E2E=true
            RUN_DOCKER=true
            shift
            ;;
        -c|--coverage)
            RUN_COVERAGE=true
            shift
            ;;
        -f|--file)
            TEST_FILE="$2"
            shift 2
            ;;
        -q|--quiet)
            VERBOSITY="-q"
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Change to project root
cd "$(dirname "$0")"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}       Portfolio Test Runner          ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    echo -e "${GREEN}Loading environment variables from .env...${NC}"
    set -a
    source .env
    set +a
else
    echo -e "${YELLOW}Warning: .env file not found. Using default values.${NC}"
    # Set minimal defaults for tests
    export JWT_SECRET_KEY="test-secret-key-for-unit-tests-min-32-chars"
    export DB_HOST=localhost
    export DB_PORT=3306
    export DB_NAME=time_tracker
    export DB_USER=app_user
    export DB_PASSWORD=test_password
fi

# Set environment variables based on test types
export RUN_INTEGRATION_TESTS=$RUN_INTEGRATION
export RUN_E2E_TESTS=$RUN_E2E
export RUN_DOCKER_TESTS=$RUN_DOCKER

# Build pytest command
PYTEST_CMD="pytest"

# Add verbosity
if [ "$VERBOSITY" == "-q" ]; then
    PYTEST_CMD="$PYTEST_CMD -q"
else
    PYTEST_CMD="$PYTEST_CMD -v"
fi

# Add coverage if requested
if [ "$RUN_COVERAGE" == true ]; then
    PYTEST_CMD="$PYTEST_CMD --cov=flask-server --cov=next-version --cov-report=html --cov-report=term"
fi

# Add specific test file if provided
if [ -n "$TEST_FILE" ]; then
    PYTEST_CMD="$PYTEST_CMD test/$TEST_FILE"
else
    # By default, only run unit tests (exclude integration, e2e, and docker)
    if [ "$RUN_UNIT" == true ] && [ "$RUN_INTEGRATION" == false ] && [ "$RUN_E2E" == false ] && [ "$RUN_DOCKER" == false ]; then
        # Only run unit tests (no markers)
        PYTEST_CMD="$PYTEST_CMD test/test_flask_app.py"
    else
        PYTEST_CMD="$PYTEST_CMD test/"
    fi
fi

# Print configuration
echo -e "${YELLOW}Test Configuration:${NC}"
echo "  Unit Tests: $RUN_UNIT"
echo "  Integration Tests: $RUN_INTEGRATION"
echo "  E2E Tests: $RUN_E2E"
echo "  Docker Tests: $RUN_DOCKER"
echo "  Coverage: $RUN_COVERAGE"
echo ""

# Check prerequisites
check_prereqs() {
    # Check if Python is available
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}Error: Python 3 is required but not installed${NC}"
        exit 1
    fi

    # Check if pytest is installed
    if ! python3 -m pytest --version &> /dev/null; then
        echo -e "${YELLOW}Pytest not found. Installing test dependencies...${NC}"
        pip3 install -r test-requirements.txt
    fi

    # Check for integration test prerequisites
    if [ "$RUN_INTEGRATION" == true ]; then
        if ! command -v mysql &> /dev/null; then
            echo -e "${YELLOW}Warning: MySQL client not found. Integration tests may fail.${NC}"
        fi
    fi

    # Check for Docker test prerequisites
    if [ "$RUN_DOCKER" == true ]; then
        if ! command -v docker &> /dev/null; then
            echo -e "${RED}Error: Docker is required for Docker tests but not installed${NC}"
            exit 1
        fi
        if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
            echo -e "${RED}Error: Docker Compose is required for Docker tests but not installed${NC}"
            exit 1
        fi
    fi
}

# Run pre-checks
check_prereqs

# Print what we're about to run
echo -e "${YELLOW}Running tests...${NC}"
echo -e "${BLUE}Command: $PYTEST_CMD${NC}"
echo ""

# Run tests
if eval "$PYTEST_CMD"; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}          All Tests Passed!           ${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    if [ "$RUN_COVERAGE" == true ]; then
        echo ""
        echo -e "${BLUE}Coverage report generated at: htmlcov/index.html${NC}"
    fi
    
    exit 0
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}           Tests Failed!                ${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi
