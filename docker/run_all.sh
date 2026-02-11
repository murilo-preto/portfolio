#!/usr/bin/env bash
set -e pipefail

parent_path=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )
cd "$parent_path"

echo "Running Flask"
../flask-server/deploy_flask.sh

echo "Running MySQL"
../mysql/deploy_mysql.sh

echo "Running NextJs"
../next-version/run_docker.sh

echo "Done"
