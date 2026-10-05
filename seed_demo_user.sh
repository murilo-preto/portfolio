#!/bin/bash
# Seed a local demo account with a month of data, to see how a theme looks.
# Usage: ./seed_demo_user.sh [--username NAME] [--password PASS]
#                            [--theme system|light|dark]
#                            [--dark-style default|oled|glass]
#
# Needs the stack running (docker compose up). The seeding script runs inside
# the Flask container through the public API, so there is no local Python
# requirement and the data passes the same validation a real client's would.

set -e

cd "$(dirname "$0")"

if ! docker compose ps --status running --services | grep -qx flask; then
    echo "Flask is not running. Start the stack first: docker compose up -d --build" >&2
    exit 1
fi

# The host's offset goes first so an explicit --utc-offset in "$@" wins.
docker compose exec -T flask python - --utc-offset="$(date +%:z)" "$@" \
    < scripts/seed_demo_user.py
