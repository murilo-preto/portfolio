#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Stopping old container (if any)..."
docker rm -f flask_app 2>/dev/null || true

echo "Building image..."
./build_flask.sh

echo "Starting container..."
./run_flask.sh

echo "Rebuild complete."
