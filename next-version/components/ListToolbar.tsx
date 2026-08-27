"use client";

import { useEffect, useState } from "react";
import {
  PAGE_SIZE,
  type ListQuery,
  type PageMeta,
  type SortDirection,
  hasFilters,
  withChange,
} from "@/lib/list-query";

export type SortOption = { value: string; label: string };

type ListToolbarProps = {
  query: ListQuery;
  onChange: (next: ListQuery) => void;
  categories: string[];
  sortOptions: SortOption[];
  page: PageMeta | null;
  loading: boolean;
  /** Plural noun for the result count — "entries", "purchases". */
  noun: string;
};

const controlClass =
  "px-2.5 py-1.5 rounded-lg border border-default bg-surface-raised text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:opacity-60";

/** Keystrokes are not queries. Waiting this long turns a typed word into one
 *  request instead of one per letter. */
const SEARCH_DEBOUNCE_MS = 300;

export function ListToolbar({
  query,
  onChange,
  categories,
  sortOptions,
  page,
  loading,
  noun,
}: ListToolbarProps) {
  // The input is uncontrolled by the query so typing stays responsive; the
  // committed value flows upward on a timer.
  const [draft, setDraft] = useState(query.q);
  const [lastCommitted, setLastCommitted] = useState(query.q);

  // Keeps the box honest when the query is reset from outside ("Clear
  // filters"). Adjusting during render rather than in an effect is React's
  // documented way to follow a prop: it re-renders before anything paints,
  // where an effect would flash the stale text first.
  if (query.q !== lastCommitted) {
    setLastCommitted(query.q);
    setDraft(query.q);
  }

  useEffect(() => {
    if (draft === query.q) return;
    const id = setTimeout(() => {
      setLastCommitted(draft.trim());
      onChange(withChange(query, { q: draft.trim() }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const filtered = hasFilters(query);
  const total = page?.total ?? 0;
  const first = total === 0 ? 0 : query.offset + 1;
  const last = Math.min(query.offset + PAGE_SIZE, total);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Search ${noun}…`}
          aria-label={`Search ${noun}`}
          className={`${controlClass} flex-1 min-w-[10rem]`}
        />

        <select
          value={query.category}
          onChange={(e) =>
            onChange(withChange(query, { category: e.target.value }))
          }
          aria-label="Filter by category"
          className={controlClass}
        >
          <option value="">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={query.sort}
          onChange={(e) => onChange(withChange(query, { sort: e.target.value }))}
          aria-label="Sort by"
          className={controlClass}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          onClick={() =>
            onChange(
              withChange(query, {
                direction: (query.direction === "asc"
                  ? "desc"
                  : "asc") as SortDirection,
              }),
            )
          }
          aria-label={
            query.direction === "asc"
              ? "Sorted ascending, switch to descending"
              : "Sorted descending, switch to ascending"
          }
          className={`${controlClass} w-9 text-center`}
        >
          {query.direction === "asc" ? "↑" : "↓"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">From</label>
        <input
          type="date"
          value={query.from}
          max={query.to || undefined}
          onChange={(e) => onChange(withChange(query, { from: e.target.value }))}
          aria-label="From date"
          className={controlClass}
        />
        <label className="text-xs text-muted">to</label>
        <input
          type="date"
          value={query.to}
          min={query.from || undefined}
          onChange={(e) => onChange(withChange(query, { to: e.target.value }))}
          aria-label="To date"
          className={controlClass}
        />

        {filtered && (
          <button
            onClick={() =>
              onChange(
                withChange(query, { q: "", category: "", from: "", to: "" }),
              )
            }
            className="text-xs px-2.5 py-1.5 rounded-lg border border-default
                       bg-surface-raised hover:bg-surface-hover transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {loading
            ? "Loading…"
            : total === 0
              ? `No ${noun} found`
              : `${first}–${last} of ${total} ${noun}`}
        </span>

        {page && (page.offset > 0 || page.has_more) && (
          <span className="flex items-center gap-1">
            <button
              onClick={() =>
                onChange(
                  withChange(query, {
                    offset: Math.max(0, query.offset - PAGE_SIZE),
                  }),
                )
              }
              disabled={loading || query.offset === 0}
              className={`${controlClass} px-2 py-1 disabled:cursor-not-allowed`}
            >
              ← Prev
            </button>
            <button
              onClick={() =>
                onChange(
                  withChange(query, { offset: query.offset + PAGE_SIZE }),
                )
              }
              disabled={loading || !page.has_more}
              className={`${controlClass} px-2 py-1 disabled:cursor-not-allowed`}
            >
              Next →
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
