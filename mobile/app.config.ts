import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Two builds come from this one config, chosen by APP_VARIANT at build time:
 *
 * - "release": dev.mpreto.namu, HTTPS only, signed with the private release
 *   key. This is the app that goes on the phone for real.
 * - "lan": dev.mpreto.namu.lan, a test build that also allows plain HTTP to a
 *   private network address, for pairing with `docker compose up` on a laptop
 *   or with the Docker emulator. It has its own id, so it installs alongside
 *   the real app, and is signed with the throwaway debug key.
 *
 * Android cannot limit cleartext to address ranges, only to listed domains, so
 * the LAN build allows cleartext at the platform level and src/serverUrl.ts
 * refuses any http:// URL whose host is not private. The release build keeps
 * Android's default of no cleartext at all.
 *
 * The bundle reads the variant from EXPO_PUBLIC_APP_VARIANT, which Metro
 * inlines at build time; build_apk.sh sets both from the same value.
 */
const variant = process.env.APP_VARIANT === "lan" ? "lan" : "release";
const isLan = variant === "lan";

// Android only installs an update over the existing app when this is higher.
// build_apk.sh passes the git commit count.
const versionCode = Number(process.env.VERSION_CODE ?? "1");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isLan ? "Namu LAN" : "Namu",
  slug: "namu",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: isLan ? "dev.mpreto.namu.lan" : "dev.mpreto.namu",
    versionCode,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-secure-store",
    [
      "expo-build-properties",
      { android: { usesCleartextTraffic: isLan } },
    ],
    "./plugins/withReleaseSigning",
  ],
  extra: { variant },
});
