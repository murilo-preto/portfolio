#!/bin/bash
# Runs inside the emulator container (see run.sh): waits for boot, installs the
# LAN APK, creates a throwaway account, and runs every Maestro flow in order.
set -euo pipefail

OUT=/e2e-output
trap 'chown -R "${HOST_UID}:${HOST_UID}" "$OUT" 2>/dev/null || true' EXIT

echo "Waiting for the emulator to boot..."
adb wait-for-device
for _ in $(seq 1 180); do
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
    sleep 2
done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] || {
    echo "The emulator did not boot; see $OUT/emulator.log" >&2
    exit 1
}

# Animations make Maestro's waits slower and flakier, and test nothing.
for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb shell settings put global "$setting" 0
done

APK=$(ls -t /apk/namu-lan-*.apk | head -1)
echo "Installing $(basename "$APK")..."
adb install -r "$APK" > /dev/null

API="http://${NEXTJS_HOST}:5000/api"
NAMU_USER="e2e_$(date +%s)"
NAMU_PASSWORD="E2e-$(head -c 12 /dev/urandom | base64 | tr -d '/+=')"
curl -fsS -o /dev/null -H 'Content-Type: application/json' \
    -d "{\"username\":\"$NAMU_USER\",\"password\":\"$NAMU_PASSWORD\"}" "$API/register"

cd "$OUT"
status=0
for flow in /e2e/flows/[0-9]*.yaml; do
    echo "--- $(basename "$flow")"
    if ! maestro test \
        --env NAMU_USER="$NAMU_USER" \
        --env NAMU_PASSWORD="$NAMU_PASSWORD" \
        --env NAMU_API="$API" \
        --env NAMU_FLASK="http://flask:3000" \
        --test-output-dir "$OUT/$(basename "$flow" .yaml)" \
        "$flow"; then
        status=1
        adb exec-out screencap -p > "$OUT/failed-$(basename "$flow" .yaml).png" || true
        break
    fi
done

adb logcat -d > "$OUT/logcat.txt" || true
exit $status
