/**
 * Which build this is. Metro inlines EXPO_PUBLIC_* variables at bundle time,
 * and build_apk.sh sets this one from the same value as APP_VARIANT, which
 * app.config.ts reads. See app.config.ts for what differs between the two.
 */
export type Variant = "release" | "lan";

export const VARIANT: Variant =
  process.env.EXPO_PUBLIC_APP_VARIANT === "lan" ? "lan" : "release";

/** What the server field starts with. The LAN build is pointed at a laptop. */
export const DEFAULT_SERVER_URL =
  VARIANT === "lan" ? "http://10.0.2.2:5000" : "https://murilopreto.com.br";
