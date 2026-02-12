#!/usr/bin/env bash
set -e pipefail

parent_path=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
cd "$parent_path"

echo "Stopping all"
./stop_all.sh

echo "Running MySQL"
../mysql/deploy_mysql.sh

echo "Running NextJs"
../next-version/run_docker.sh

echo "Running Flask"
../flask-server/exposed_port_container.sh

echo "Waiting for Flask to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:3000/health > /dev/null; then
    echo "Flask is ready!"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 1
done

echo "Seeding MySQL"
source ../flask-server/.venv/bin/activate
python3 ../flask-server/seed.py

echo "Done"
