#!/bin/bash
# Create the release signing key, once. Run from anywhere.
#
# Writes NAMU_KEYSTORE_DIR (default ~/.namu-keys)/release.keystore and its
# password file. Back both up somewhere safe: Android only installs an update
# over an app signed with the same key, so losing it means uninstalling the app
# and pairing the phone again.
#
# keytool runs in the same image the APK is built with, so no local JDK is needed.

set -euo pipefail

cd "$(dirname "$0")/.."

KEY_DIR="${NAMU_KEYSTORE_DIR:-$HOME/.namu-keys}"
if [ -e "$KEY_DIR/release.keystore" ]; then
    echo "$KEY_DIR/release.keystore already exists; refusing to overwrite it." >&2
    exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

# A long random password, kept next to the key. The key file is only as safe as
# this directory either way.
umask 077
head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$KEY_DIR/password"

docker build --target android -t namu-mobile-android .
docker run --rm -u "$(id -u):$(id -g)" -v "$KEY_DIR":/keys namu-mobile-android \
    sh -c 'keytool -genkeypair -v -storetype PKCS12 \
        -keystore /keys/release.keystore -alias namu \
        -keyalg RSA -keysize 4096 -validity 36500 \
        -storepass "$(cat /keys/password)" \
        -dname "CN=Namu, O=mpreto.dev"'

echo
echo "Created $KEY_DIR/release.keystore. Back up the whole $KEY_DIR directory now."
