import { headers } from "next/headers";

/**
 * Headers that let Flask key rate limits on the real caller.
 *
 * Every request Flask sees originates from this container, so its own view of
 * the peer address is the same for every user. Relaying the browser's address
 * gives it something better to bucket anonymous callers by.
 *
 * The secret is what makes the relayed address believable. Flask's port is
 * published to the host, so an unauthenticated `X-Forwarded-For` would let any
 * direct caller pick their own rate-limit bucket — worse than no forwarding at
 * all. Flask ignores the address unless this header matches; see
 * flask-server/rate_limit.py.
 *
 * Both headers are sent or neither is. Sending the secret with no address to go
 * with it asserts nothing and only widens where the secret travels.
 *
 * In local development the browser connects to this container directly, so
 * there is no incoming address to relay and this returns nothing. In the public
 * deployment nginx sits in front and sets X-Forwarded-For to the connecting
 * address, discarding any the client sent (deploy/nginx-site.conf.example).
 * That deployment also publishes this container's port on loopback only
 * (docker-compose.prod.yml), which matters: a caller reaching it directly
 * could set the header themselves.
 */
export async function clientForwardingHeaders(): Promise<Record<string, string>> {
  const secret = process.env.INTERNAL_PROXY_SECRET;
  if (!secret) return {};

  const incoming = await headers();
  const clientAddress =
    incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  if (!clientAddress) return {};

  return {
    "X-Proxy-Auth": secret,
    "X-Forwarded-For": clientAddress,
  };
}
