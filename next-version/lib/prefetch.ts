"use client";

/**
 * Hover-time warm-up for navigations.
 *
 * `next/link` already prefetches a route's JS and RSC payload, but every page
 * under /namu fetches its own data from `/api/*` on mount, so the slow part of
 * a navigation only starts once the page is already on screen. Hovering a nav
 * link fires those GETs early and parks the in-flight promise here; the page
 * then picks it up instead of opening a second request.
 */

/** The GETs a route issues on mount, warmed when its nav link is hovered. */
const ROUTE_DATA: Record<string, readonly string[]> = {
  // The Today dashboard reads one endpoint per domain it summarises.
  "/namu/user": [
    "/api/entry",
    "/api/todo",
    "/api/finance",
    "/api/pomodoro/stats",
    "/api/pomodoro/sessions",
  ],
  "/namu/user/entries": ["/api/entry"],
  "/namu/user/timer": ["/api/entry", "/api/categories"],
  "/namu/user/manage": ["/api/entry", "/api/categories"],
  "/namu/user/todo": ["/api/todo", "/api/todo/categories", "/api/todo/tags"],
  "/namu/user/pomodoro": ["/api/todo", "/api/pomodoro/stats"],
  "/namu/user/finance": ["/api/finance", "/api/finance/categories"],
  "/namu/user/finance/manage": ["/api/finance", "/api/finance/categories"],
  "/namu/user/categories": [
    "/api/categories",
    "/api/finance/categories",
    "/api/todo/categories",
  ],
  "/namu/user/settings": ["/api/user/preferences"],
};

/** How long a warmed response may still be handed to a page. Past this the
 *  page is better off asking again than rendering data the user has moved on
 *  from. Hover-to-click is normally well under a second. */
const MAX_AGE_MS = 15_000;

type WarmedResponse = {
  /** When the request went out. */
  at: number;
  /** Path the user was on when it was warmed — see `warmFetch`. */
  from: string;
  response: Promise<Response>;
};

const warmed = new Map<string, WarmedResponse>();

function isFresh(entry: WarmedResponse): boolean {
  return Date.now() - entry.at < MAX_AGE_MS;
}

/** Skip speculative requests on connections where they would compete with the
 *  navigation the user actually makes. */
function connectionIsTooSlow(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    connection.effectiveType === "slow-2g" ||
    connection.effectiveType === "2g"
  );
}

function warmEndpoint(url: string) {
  const existing = warmed.get(url);
  if (existing && isFresh(existing)) return;

  const response = fetch(url, { credentials: "include" });
  warmed.set(url, { at: Date.now(), from: window.location.pathname, response });

  // A failed warm-up must not linger as a poisoned entry, and its rejection
  // must not surface as an unhandled promise before a page awaits it.
  response.catch(() => {
    if (warmed.get(url)?.response === response) warmed.delete(url);
  });
}

/** Start the data a route needs on mount. Safe to call repeatedly. */
export function prefetchRouteData(href: string) {
  if (typeof window === "undefined" || connectionIsTooSlow()) return;

  const endpoints = ROUTE_DATA[href.split(/[?#]/)[0].replace(/\/+$/, "")];
  if (!endpoints) return;

  for (const url of endpoints) warmEndpoint(url);
}

/**
 * `fetch` that adopts a hover-warmed response when one is waiting.
 *
 * A warmed response is only served when the page it was warmed from is not the
 * page asking for it — i.e. a navigation actually happened in between. That
 * keeps a hover that never turned into a click from feeding stale data back to
 * the page the user stayed on, where they may have just changed the data. The
 * entry is consumed on first use, so a later refresh always hits the network.
 */
export function warmFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const entry = warmed.get(url);

  if (
    method === "GET" &&
    entry &&
    isFresh(entry) &&
    entry.from !== window.location.pathname
  ) {
    warmed.delete(url);
    return entry.response;
  }

  return fetch(url, init);
}
