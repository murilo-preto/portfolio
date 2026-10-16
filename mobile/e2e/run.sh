#!/bin/bash
# End-to-end tests of the LAN APK on a headless emulator, against a fresh copy
# of the whole stack. Like Playwright, deliberately outside run_tests.sh: it
# needs /dev/kvm and takes minutes.
#
#   ./mobile/e2e/run.sh            build the LAN APK if there is none, then test
#   ./mobile/e2e/run.sh --rebuild  rebuild the LAN APK first
#
# Screenshots, the Maestro reports, logcat and the emulator log land in
# mobile/e2e/output/.

set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -r /dev/kvm ]; then
    echo "No usable /dev/kvm: the emulator needs hardware virtualisation." >&2
    exit 1
fi

if [ "${1:-}" = "--rebuild" ] || ! ls mobile/dist/namu-lan-*.apk > /dev/null 2>&1; then
    ./mobile/build_apk.sh --lan
fi

rm -rf mobile/e2e/output
mkdir -p mobile/e2e/output

export HOST_UID
HOST_UID=$(id -u)
COMPOSE=(docker compose -p namu-e2e -f docker-compose.yml -f mobile/e2e/docker-compose.e2e.yml)
trap '"${COMPOSE[@]}" down -v > /dev/null 2>&1' EXIT

"${COMPOSE[@]}" up -d --build --wait mysql flask nextjs
"${COMPOSE[@]}" up -d --build emulator

if "${COMPOSE[@]}" exec -T emulator /e2e/run-flows.sh; then
    echo "Emulator end-to-end tests passed. Output: mobile/e2e/output/"
else
    echo "Emulator end-to-end tests FAILED. Screenshots and logs: mobile/e2e/output/" >&2
    exit 1
fi
