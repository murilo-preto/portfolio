#!/bin/bash
# Test runner — runs the full test suite inside Docker Compose
# Usage: ./run_tests.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$(dirname "$0")"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}       Portfolio Test Runner          ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is required but not installed${NC}"
    exit 1
fi

if [ -f ".env" ]; then
    echo -e "${GREEN}Loading environment variables from .env...${NC}"
    set -a
    source .env
    set +a
else
    echo -e "${RED}Error: .env file not found. Copy env.example.txt to .env and fill in values.${NC}"
    exit 1
fi

REQUIRED_IMAGES=("python:3.12-slim" "python:3.12" "node:20-alpine" "mysql:8.0")
for image in "${REQUIRED_IMAGES[@]}"; do
    if ! docker image inspect "$image" &> /dev/null; then
        echo -e "${YELLOW}Image $image not found locally — pulling...${NC}"
        if ! docker pull "$image"; then
            echo -e "${RED}Error: Failed to pull $image. Check your network connection or pull images manually:${NC}"
            for img in "${REQUIRED_IMAGES[@]}"; do
                echo "  docker pull $img"
            done
            exit 1
        fi
    fi
done

trap 'docker compose -f docker-compose.yml -f docker-compose.test.yml down' EXIT

echo -e "${YELLOW}Rebuilding all services and running full test suite inside Docker...${NC}"
set +e
docker compose -f docker-compose.yml -f docker-compose.test.yml \
    up --build --abort-on-container-exit --exit-code-from test
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}          All Tests Passed!           ${NC}"
    echo -e "${GREEN}========================================${NC}"
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}           Tests Failed!                ${NC}"
    echo -e "${RED}========================================${NC}"
fi

exit $EXIT_CODE
