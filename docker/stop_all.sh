#!/usr/bin/env bash
set -e pipefail

docker stop nextjs-app
docker stop mysql-db
docker stop flask_app
