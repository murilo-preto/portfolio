#!/usr/bin/env bash
set -e pipefail

docker stop nextjs-app || true
docker stop mysql-db || true
docker stop flask_app || true

docker rm nextjs-app || true
docker rm mysql-db || true
docker rm flask_app || true
