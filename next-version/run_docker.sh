#!/usr/bin/env bash
set -e

IMAGE_NAME="nextjs-app"
CONTAINER_NAME="nextjs-app"
HOST_PORT=5000
CONTAINER_PORT=3000

echo "Building Docker image"
docker build -t "$IMAGE_NAME" .

if [ "$(docker ps -aq -f name=^${CONTAINER_NAME}$)" ]; then
  echo "Stopping existing container..."
  docker stop "$CONTAINER_NAME" >/dev/null || true
  docker rm "$CONTAINER_NAME" >/dev/null || true
fi

echo "Running container on port $HOST_PORT..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --network namu \
  -p "$HOST_PORT:$CONTAINER_PORT" \
  --restart unless-stopped \
  "$IMAGE_NAME"

echo "App is running at http://localhost:$HOST_PORT"
