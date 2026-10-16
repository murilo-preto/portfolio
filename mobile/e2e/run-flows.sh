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

# Geofencing runs in Play services, which refuses it while "Google Location
# Accuracy" is off. The emulator image ships with it off: Play services'
# geofencer then stays in DisabledState and turns down every geofence the app
# adds, however the position is mocked. It is a Play services screen, not a
# system setting, so the switch is found in a UI dump and tapped.
#
# Decided by the switch's own state, then confirmed by the fused provider.
# An earlier version read only `dumpsys location`, matched the GPS provider's
# "enabled=true" by mistake, and so never tapped at all.
#
# Play services is still settling for a while after boot, so the screen is
# retried rather than expected on the first look. Plain variables and
# `|| true` rather than pipelines into `grep -q`: under pipefail those fail on
# SIGPIPE and would abort the script with no message.
accuracy_switch() {
    adb shell am start -W -n com.google.android.gms/.location.settings.LocationAccuracyNonwearableActivity > /dev/null 2>&1 || true
    sleep 3
    adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || true
    local ui
    ui=$(adb shell cat /sdcard/ui.xml 2>/dev/null || true)
    echo "$ui" > "$OUT/location-accuracy-ui.xml"
    echo "$ui" | grep -o '<node[^>]*resource-id="android:id/switch_widget"[^>]*>' | head -1 || true
}

# "enabled=true" inside the fused provider's own block only.
fused_enabled() {
    adb shell dumpsys location 2>/dev/null \
        | awk '/fused provider:/ {f = 1; next} / provider:/ {f = 0} f && /enabled=true/ {n++} END {print n + 0}' \
        || echo 0
}

echo "Turning on Google Location Accuracy..."
accuracy_on=""
for _ in $(seq 1 10); do
    switch=$(accuracy_switch)
    if [[ "$switch" == *'checked="true"'* ]]; then
        accuracy_on=1
        break
    fi
    if [[ "$switch" == *'checked="false"'* ]]; then
        read -r x1 y1 x2 y2 <<< "$(echo "$switch" | grep -o 'bounds="[^"]*"' | head -1 | tr -c '0-9' ' ')"
        adb shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
    fi
    sleep 3
done
adb shell input keyevent KEYCODE_HOME
sleep 3
if [ -z "$accuracy_on" ] || [ "$(fused_enabled)" -eq 0 ]; then
    echo "Could not turn on Google Location Accuracy; 07_geofence_stay cannot pass." >&2
    echo "The last UI dump is in $OUT/location-accuracy-ui.xml" >&2
    exit 1
fi
rm -f "$OUT/location-accuracy-ui.xml"

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
run_flow() {
    maestro test \
        --env NAMU_USER="$NAMU_USER" \
        --env NAMU_PASSWORD="$NAMU_PASSWORD" \
        --env NAMU_API="$API" \
        --env NAMU_FLASK="http://flask:3000" \
        --test-output-dir "$OUT/$1" \
        "$2"
}

for flow in /e2e/flows/[0-9]*.yaml; do
    name=$(basename "$flow" .yaml)
    echo "--- $name.yaml"
    if run_flow "$name" "$flow"; then continue; fi

    # adb sometimes drops the emulator for a moment as an app is cleared and
    # relaunched ("device offline"), failing the flow before it has tested
    # anything. That, and only that, gets one more try.
    if grep -rqs "device offline" "$OUT/$name"; then
        echo "--- $name.yaml: adb lost the emulator; reconnecting and retrying once"
        adb reconnect > /dev/null 2>&1 || true
        adb wait-for-device
        if run_flow "$name-retry" "$flow"; then continue; fi
    fi

    status=1
    adb exec-out screencap -p > "$OUT/failed-$name.png" || true
    break
done

adb logcat -d > "$OUT/logcat.txt" || true
exit $status
