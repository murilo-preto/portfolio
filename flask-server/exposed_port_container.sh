#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Stopping old container (if any)..."
docker rm -f flask_app 2>/dev/null || true

echo "Building image..."
docker build -t flask:1.0 .

echo "Starting container..."
docker run \
  --rm -d \
  --name flask_app \
  -p 5000:5000 \
  --network namu \
flask:1.0

echo "Rebuild complete."
