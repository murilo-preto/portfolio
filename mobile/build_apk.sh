#!/bin/bash
# Build the Namu Android app in Docker. No local JDK or Android SDK needed.
#
#   ./mobile/build_apk.sh          release APK, signed with the release key
#   ./mobile/build_apk.sh --lan    LAN test APK (dev.mpreto.namu.lan), debug key
#
# The APK lands in mobile/dist/. The release key is read from NAMU_KEYSTORE_DIR
# (default ~/.namu-keys), which scripts/create_keystore.sh creates once. It is
# passed to the build as BuildKit secrets, so it never enters an image layer.

set -euo pipefail

cd "$(dirname "$0")"

VARIANT=release
if [ "${1:-}" = "--lan" ]; then
    VARIANT=lan
elif [ -n "${1:-}" ]; then
    echo "Usage: $0 [--lan]" >&2
    exit 2
fi

# Android installs an update only over a lower versionCode. The commit count
# only ever grows on one branch's history.
VERSION_CODE=$(git rev-list --count HEAD)

SECRETS=()
if [ "$VARIANT" = "release" ]; then
    KEY_DIR="${NAMU_KEYSTORE_DIR:-$HOME/.namu-keys}"
    if [ ! -f "$KEY_DIR/release.keystore" ] || [ ! -f "$KEY_DIR/password" ]; then
        echo "No release key in $KEY_DIR. Create it once with mobile/scripts/create_keystore.sh," >&2
        echo "or build the LAN test APK with --lan." >&2
        exit 1
    fi
    SECRETS=(
        --secret "id=namu_keystore,src=$KEY_DIR/release.keystore"
        --secret "id=namu_keystore_password,src=$KEY_DIR/password"
    )
fi

echo "Running the mobile tests..."
docker build --target test -t namu-mobile-test .
docker run --rm namu-mobile-test

echo "Building the $VARIANT APK (versionCode $VERSION_CODE)..."
DOCKER_BUILDKIT=1 docker build \
    --target apk \
    --build-arg "APP_VARIANT=$VARIANT" \
    --build-arg "VERSION_CODE=$VERSION_CODE" \
    "${SECRETS[@]}" \
    --output type=local,dest=dist \
    .

echo "Built mobile/dist/namu-$VARIANT-$VERSION_CODE.apk"
