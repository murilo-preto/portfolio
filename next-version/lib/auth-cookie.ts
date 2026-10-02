/**
 * Terms for the `access_token` cookie, shared by the login route and the
 * token-refresh path so the two cannot drift apart.
 *
 * `secure` follows COOKIE_SECURE rather than NODE_ENV. The image runs with
 * NODE_ENV=production everywhere, including on plain-HTTP localhost in
 * development and in the test stack, where a Secure cookie would never be sent
 * back. Only the public deployment behind the HTTPS proxy
 * (docker-compose.prod.yml) sets it.
 */
export function accessTokenCookie(value: string) {
  return {
    name: "access_token",
    value,
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 48, // 48 hours to match TOKEN_DURATION_HOURS
  };
}
