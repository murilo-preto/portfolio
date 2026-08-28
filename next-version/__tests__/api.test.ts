/**
 * Next.js API route tests.
 *
 * These routes are thin proxies: they attach credentials, forward to Flask, and
 * hand the answer back. So what is worth testing here is the forwarding and the
 * credential handling — not validation, which lives in Flask and is covered by
 * the pytest tiers. The file this replaced tested the opposite, asserting that
 * the proxies rejected bad payloads with 400s of their own. It had never been
 * executed (vitest was not a dependency), and when it finally was, 21 of its 26
 * cases failed against behaviour the proxies have never had.
 *
 * The seam is `fetch`, mocked throughout, plus `next/headers` — route handlers
 * read cookies and headers from an async request store that only exists inside a
 * real request, so it is stubbed here with something a test can drive.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookieJar: Map<string, string>;
let incomingHeaders: Headers;
const cookiesSet: Array<Record<string, unknown>> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined,
  }),
  headers: async () => incomingHeaders,
}));

const FLASK = "http://flask:3000";

/** A Flask reply that parses as JSON. */
function flaskJson(status: number, body: unknown, headers: HeadersInit = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

/** A Flask reply that does not parse as JSON — an error page, an empty 502. */
function flaskNotJson(status: number) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  cookieJar = new Map();
  incomingHeaders = new Headers();
  cookiesSet.length = 0;
  delete process.env.INTERNAL_PROXY_SECRET;
  vi.resetModules();
  global.fetch = vi.fn() as unknown as typeof fetch;
});

describe("health", () => {
  it("reports healthy without touching Flask", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("healthy");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("login proxy", () => {
  it("stores the token in an httpOnly cookie and keeps it out of the body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(200, {
        access_token: "a-real-token",
        user_id: 7,
        username: "alice",
      }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "pw" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ authenticated: true, user_id: 7, username: "alice" });
    // The whole point of the httpOnly cookie is that script cannot read the
    // token. Returning it in the body as well would hand it straight back.
    expect(body.access_token).toBeUndefined();

    const cookie = response.cookies.get("access_token");
    expect(cookie?.value).toBe("a-real-token");
    expect(cookie?.httpOnly).toBe(true);
  });

  it("passes a 401 through with its message", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(401, { error: "Invalid username or password" }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "no" }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Invalid username or password");
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("passes a 429 through instead of turning it into a blank 500", async () => {
    // The bug 5cabf8f fixed: Flask-Limiter's stock 429 is an HTML page, and this
    // proxy parsed every response as JSON, so tripping a limit threw inside the
    // handler and reached the browser as a 500 with nothing to act on. Flask now
    // answers 429 in JSON and this asserts the proxy relays it.
    //
    // The e2e tier used to cover this by driving the real limiter until it
    // tripped, which stopped being possible once limiting was turned off for the
    // test stack — it skipped itself instead. Here it is deterministic.
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(429, { error: "Too many requests. Please wait and try again." }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "no" }),
    );

    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/too many requests/i);
  });

  it("does not claim success when Flask answers 200 without a token", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(200, { message: "odd but tokenless" }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "pw" }),
    );

    expect(await response.json()).toHaveProperty("error");
    expect(response.cookies.get("access_token")).toBeUndefined();
  });

  it("keeps the upstream status when the response is not JSON", async () => {
    vi.mocked(global.fetch).mockResolvedValue(flaskNotJson(502) as unknown as Response);

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "pw" }),
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/unexpected response/i);
  });

  it("answers 502 when Flask cannot be reached at all", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const { POST } = await import("@/app/api/login/route");
    const response = await POST(
      jsonRequest(`${FLASK}/login`, { username: "alice", password: "pw" }),
    );

    expect(response.status).toBe(502);
  });

  it("rejects a malformed body before calling Flask", async () => {
    const { POST } = await import("@/app/api/login/route");
    const response = await POST(jsonRequest(`${FLASK}/login`, "{not json"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("register proxy", () => {
  it("relays Flask's answer verbatim, status and all", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(409, { error: "Username already exists" }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/register/route");
    const response = await POST(
      jsonRequest(`${FLASK}/register`, { username: "taken", password: "pw" }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Username already exists");
  });

  it("passes a 429 through", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(429, { error: "Too many requests." }) as unknown as Response,
    );

    const { POST } = await import("@/app/api/register/route");
    const response = await POST(
      jsonRequest(`${FLASK}/register`, { username: "x", password: "pw" }),
    );

    expect(response.status).toBe(429);
  });

  it("answers 502 when Flask cannot be reached", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const { POST } = await import("@/app/api/register/route");
    const response = await POST(
      jsonRequest(`${FLASK}/register`, { username: "x", password: "pw" }),
    );

    expect(response.status).toBe(502);
  });
});

describe("logout", () => {
  it("clears the access token", async () => {
    const { POST } = await import("@/app/api/logout/route");
    const response = await POST();

    expect(response.status).toBe(200);
    // Deletion is expressed as an expired cookie on the way out.
    expect(response.cookies.get("access_token")?.value).toBe("");
  });
});

describe("fetchWithTokenRefresh", () => {
  it("refuses without a token and never reaches Flask", async () => {
    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    const { response, ok } = await fetchWithTokenRefresh(`${FLASK}/entry`);

    expect(ok).toBe(false);
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the cookie's token as a bearer header", async () => {
    cookieJar.set("access_token", "stored-token");
    vi.mocked(global.fetch).mockResolvedValue(flaskJson(200, { entries: [] }) as unknown as Response);

    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    await fetchWithTokenRefresh(`${FLASK}/entry`);

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer stored-token",
    );
  });

  it("adopts a token Flask refreshed mid-request", async () => {
    cookieJar.set("access_token", "old-token");
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(200, { ok: true }, {
        "Set-Cookie": "access_token=refreshed-token; Path=/; HttpOnly",
      }) as unknown as Response,
    );

    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    const { response } = await fetchWithTokenRefresh(`${FLASK}/entry`);

    const refreshed = response.cookies.get("access_token");
    expect(refreshed?.value).toBe("refreshed-token");
    // The refresh path writes its own cookie rather than reusing the login
    // route's, so it has to be held to the same terms — a token that silently
    // became script-readable on renewal would undo the httpOnly guarantee for
    // every session that stayed open long enough to be refreshed.
    expect(refreshed?.httpOnly).toBe(true);
  });

  it("preserves the status when Flask's body is not JSON", async () => {
    cookieJar.set("access_token", "stored-token");
    vi.mocked(global.fetch).mockResolvedValue(flaskNotJson(503) as unknown as Response);

    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    const { response, ok } = await fetchWithTokenRefresh(`${FLASK}/entry`);

    expect(ok).toBe(false);
    expect(response.status).toBe(503);
  });

  it("reports failure without throwing when Flask rejects", async () => {
    cookieJar.set("access_token", "stored-token");
    vi.mocked(global.fetch).mockResolvedValue(
      flaskJson(403, { error: "nope" }) as unknown as Response,
    );

    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    const { response, ok } = await fetchWithTokenRefresh(`${FLASK}/entry`);

    expect(ok).toBe(false);
    expect(response.status).toBe(403);
  });
});

describe("list query forwarding", () => {
  it("passes the query string on to Flask unchanged", async () => {
    // 69ae45c moved filtering, sorting and paging into MySQL. That only works if
    // the proxy relays the parameters; dropping them silently returns the whole
    // table and looks like it worked.
    cookieJar.set("access_token", "stored-token");
    vi.mocked(global.fetch).mockResolvedValue(flaskJson(200, { entries: [] }) as unknown as Response);

    const { GET } = await import("@/app/api/entry/route");
    await GET(
      new Request(
        "http://localhost:5000/api/entry?from=2026-01-01&sort=duration&direction=desc&limit=50",
      ),
    );

    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain(
      "?from=2026-01-01&sort=duration&direction=desc&limit=50",
    );
  });
});

describe("client address forwarding", () => {
  it("sends nothing when no secret is configured", async () => {
    incomingHeaders.set("x-forwarded-for", "203.0.113.7");

    const { clientForwardingHeaders } = await import("@/lib/proxy-headers");
    expect(await clientForwardingHeaders()).toEqual({});
  });

  it("relays the caller's address under the secret", async () => {
    process.env.INTERNAL_PROXY_SECRET = "shared-secret";
    incomingHeaders.set("x-forwarded-for", "203.0.113.7");

    const { clientForwardingHeaders } = await import("@/lib/proxy-headers");
    expect(await clientForwardingHeaders()).toEqual({
      "X-Proxy-Auth": "shared-secret",
      "X-Forwarded-For": "203.0.113.7",
    });
  });

  it("falls back to x-real-ip", async () => {
    process.env.INTERNAL_PROXY_SECRET = "shared-secret";
    incomingHeaders.set("x-real-ip", "203.0.113.8");

    const { clientForwardingHeaders } = await import("@/lib/proxy-headers");
    expect((await clientForwardingHeaders())["X-Forwarded-For"]).toBe("203.0.113.8");
  });

  it("sends nothing — not even the secret — with no address to assert", async () => {
    // This is the current topology: the browser reaches this container directly,
    // so there is no upstream address to relay. Sending the secret alone would
    // assert nothing and only widen where the secret travels.
    process.env.INTERNAL_PROXY_SECRET = "shared-secret";

    const { clientForwardingHeaders } = await import("@/lib/proxy-headers");
    expect(await clientForwardingHeaders()).toEqual({});
  });

  it("reaches Flask on an authenticated call", async () => {
    process.env.INTERNAL_PROXY_SECRET = "shared-secret";
    incomingHeaders.set("x-forwarded-for", "203.0.113.7");
    cookieJar.set("access_token", "stored-token");
    vi.mocked(global.fetch).mockResolvedValue(flaskJson(200, {}) as unknown as Response);

    const { fetchWithTokenRefresh } = await import("@/lib/flask-client");
    await fetchWithTokenRefresh(`${FLASK}/entry`);

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const sent = init?.headers as Record<string, string>;
    expect(sent["X-Forwarded-For"]).toBe("203.0.113.7");
    expect(sent["X-Proxy-Auth"]).toBe("shared-secret");
    // The bearer token must survive being spread alongside them.
    expect(sent.Authorization).toBe("Bearer stored-token");
  });
});
