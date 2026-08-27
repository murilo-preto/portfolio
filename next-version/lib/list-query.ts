/**
 * Client half of the list query parameters.
 *
 * The manage screens used to download every row and filter in the browser.
 * They now hand the work to MySQL through `?from=&to=&category=&q=&sort=
 * &direction=&limit=&offset=` — the server side lives in
 * `flask-server/query_params.py`, and the two must agree on names and values.
 */

export type SortDirection = "asc" | "desc";

/** One page. Big enough that most people never touch the pager, small enough
 *  that the first paint is fast on a long history. */
export const PAGE_SIZE = 50;

export type ListQuery = {
  /** Free-text search. Empty means "no search", never `q=`. */
  q: string;
  /** Exact category name, or "" for all. */
  category: string;
  /** Inclusive ISO date bounds (YYYY-MM-DD), or "" for unbounded. */
  from: string;
  to: string;
  sort: string;
  direction: SortDirection;
  offset: number;
};

/** The pagination block a windowed response carries back. */
export type PageMeta = {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

export function emptyListQuery(
  sort: string,
  direction: SortDirection,
): ListQuery {
  return { q: "", category: "", from: "", to: "", sort, direction, offset: 0 };
}

/** True when anything is narrowing the list — drives the "clear" affordance
 *  and the wording on the export button. */
export function hasFilters(query: ListQuery): boolean {
  return !!(query.q || query.category || query.from || query.to);
}

/**
 * Serialize to a query string.
 *
 * Blank values are omitted rather than sent empty, because the API treats a
 * present-but-blank parameter as a mistake worth a 400 rather than something
 * to quietly ignore.
 *
 * `limit: null` asks for the whole matching set — used by CSV export, which
 * must cover everything the filters match and not just the visible page.
 */
export function toSearchParams(
  query: ListQuery,
  { limit }: { limit: number | null },
): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  params.set("sort", query.sort);
  params.set("direction", query.direction);
  if (limit !== null) {
    params.set("limit", String(limit));
    params.set("offset", String(query.offset));
  }
  return `?${params.toString()}`;
}

/**
 * Apply a change and send the reader back to the first page.
 *
 * Every field except `offset` changes which rows match, so keeping the old
 * offset would land them on page 7 of a 2-page result — an empty screen that
 * reads as "no matches".
 */
export function withChange(
  query: ListQuery,
  change: Partial<ListQuery>,
): ListQuery {
  const next = { ...query, ...change };
  if (change.offset === undefined) next.offset = 0;
  return next;
}
