# syntax=docker/dockerfile:1
#
# Builds the Namu Android app without a local JDK or Android SDK. Use
# build_apk.sh rather than this file directly: it supplies the variant, the
# version code and, for the release build, the signing key as BuildKit secrets.
#
# Stages:
#   deps     npm ci
#   test     typecheck + Jest (the `mobile-test` service in docker-compose.test.yml)
#   android  JDK 17 + Android SDK, pinned to what React Native 0.86 / Expo SDK 57
#            generate (compileSdk 36, build-tools 36.0.0, NDK 27.1.12297006).
#            Also the base of the emulator image in e2e/
#   build    expo prebuild + gradlew assembleRelease
#   apk      the APK alone, for `docker build --output`

# ---------- Dependencies ----------
# React Native 0.86 needs Node >= 22.13. Debian rather than Alpine: the Android
# tools are glibc binaries.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- Tests ----------
FROM deps AS test
COPY . .
CMD ["sh", "-c", "npx tsc --noEmit && npx jest --ci"]

# ---------- Android SDK ----------
FROM node:22-bookworm-slim AS android

# cmdline-tools 22.0. Its successor, 23.0 (16111833), replaces sdkmanager with
# a shell shim that downloads an unpinned "Android CLI" at build time; 22.0 is
# the last release whose sdkmanager is the Java tool itself.
ARG CMDLINE_TOOLS_VERSION=15859902
ARG CMDLINE_TOOLS_SHA1=040d3996a65543d22ec4bf73e4c37aa37a8d4af4

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN curl -fsSL -o /tmp/tools.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip \
 && echo "${CMDLINE_TOOLS_SHA1}  /tmp/tools.zip" | sha1sum -c - \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/tools.zip -d /tmp/tools \
 && mv /tmp/tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm -rf /tmp/tools /tmp/tools.zip

RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install \
      "platform-tools" \
      "platforms;android-36" \
      "build-tools;36.0.0" \
      "ndk;27.1.12297006" \
    > /dev/null

# ---------- Build ----------
FROM android AS build
WORKDIR /app

# "release" or "lan"; see app.config.ts.
ARG APP_VARIANT=release
ARG VERSION_CODE=1
ENV APP_VARIANT=$APP_VARIANT \
    EXPO_PUBLIC_APP_VARIANT=$APP_VARIANT \
    VERSION_CODE=$VERSION_CODE \
    CI=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# android/ is generated here on every build and never committed.
RUN npx expo prebuild --platform android --clean --no-install

# Only the phone's ABI and the emulator's are built, which roughly halves the
# native compile. The signing secrets are optional mounts: the LAN build signs
# with the debug key and needs none, and the release build fails in Gradle
# without them (plugins/withReleaseSigning.js) rather than falling back.
RUN --mount=type=cache,target=/root/.gradle \
    --mount=type=secret,id=namu_keystore,required=false \
    --mount=type=secret,id=namu_keystore_password,required=false \
    cd android \
 && SIGNING="" \
 && if [ "$APP_VARIANT" = "release" ] && [ -f /run/secrets/namu_keystore ]; then \
      SIGNING="-PNAMU_RELEASE_STORE_FILE=/run/secrets/namu_keystore \
               -PNAMU_RELEASE_STORE_PASSWORD=$(cat /run/secrets/namu_keystore_password)"; \
    fi \
 && ./gradlew assembleRelease --no-daemon --console=plain \
      -PreactNativeArchitectures=arm64-v8a,x86_64 \
      $SIGNING \
 && mkdir -p /out \
 && cp app/build/outputs/apk/release/app-release.apk "/out/namu-${APP_VARIANT}-${VERSION_CODE}.apk"

# ---------- Emulator + Maestro (e2e/run.sh) ----------
# A headless API 36 emulator with Google Play services, which geofencing needs,
# plus Maestro to drive the installed APK. Needs /dev/kvm from the host. Not
# part of any APK; only mobile/e2e/docker-compose.e2e.yml builds it.
FROM android AS emulator

ARG MAESTRO_VERSION=2.11.0
ARG MAESTRO_SHA256=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a

# The emulator binary links against these even when headless. socat relays the
# app's http://10.0.2.2:5000 (the emulator's name for this container) to the
# Next.js service.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      socat libpulse0 libnss3 libxcomposite1 libxcursor1 libxdamage1 libxi6 \
      libxtst6 libxrandr2 libgl1 libglib2.0-0 libxkbfile1 libbsd0 libdbus-1-3 \
      libasound2 libxkbcommon0 libxshmfence1 libdrm2 libgbm1 \
 && rm -rf /var/lib/apt/lists/*

RUN sdkmanager --install "emulator" "system-images;android-36;google_apis;x86_64" > /dev/null \
 && echo no | avdmanager create avd -n namu -k "system-images;android-36;google_apis;x86_64" -d pixel_7 > /dev/null

RUN curl -fsSL -o /tmp/maestro.zip \
      https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip \
 && echo "${MAESTRO_SHA256}  /tmp/maestro.zip" | sha256sum -c - \
 && unzip -q /tmp/maestro.zip -d /opt \
 && rm /tmp/maestro.zip

ENV PATH=$PATH:$ANDROID_HOME/emulator:/opt/maestro/bin \
    MAESTRO_CLI_NO_ANALYTICS=1 \
    MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

# The flows and scripts are mounted from mobile/e2e/ at run time rather than
# copied, so editing a flow rebuilds nothing.
ENTRYPOINT ["/e2e/emulator-entrypoint.sh"]

# ---------- APK only ----------
FROM scratch AS apk
COPY --from=build /out/ /
