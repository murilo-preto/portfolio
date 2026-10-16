import type { Variant } from "./variant";

export type ServerUrlResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Whether a host is on a private network: loopback, RFC 1918, or the Android
 * emulator's alias for its host (10.0.2.2, inside 10/8).
 */
export function isPrivateHost(host: string): boolean {
  if (host === "localhost") return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Check and normalise the server address typed on the pairing screen.
 *
 * HTTPS is always allowed. Plain HTTP is allowed only in the LAN build, and
 * only to a private host. Android can only switch cleartext on for the whole
 * app, not for address ranges, so this is where the LAN build's limit lives.
 * The release build also has cleartext off at the platform level, so an http://
 * address could not work there anyway; refusing it here says why.
 */
export function checkServerUrl(input: string, variant: Variant): ServerUrlResult {
  const trimmed = input.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Enter a full address, like https://example.com" };
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, error: "Enter the server's address only, without a path" };
  }

  if (parsed.protocol === "https:") {
    return { ok: true, url: `${parsed.protocol}//${parsed.host}` };
  }
  if (parsed.protocol === "http:") {
    if (variant !== "lan") {
      return { ok: false, error: "The server address must start with https://" };
    }
    if (!isPrivateHost(parsed.hostname)) {
      return { ok: false, error: "Plain http:// is only allowed to a local network address" };
    }
    return { ok: true, url: `${parsed.protocol}//${parsed.host}` };
  }
  return { ok: false, error: "The server address must start with https://" };
}
