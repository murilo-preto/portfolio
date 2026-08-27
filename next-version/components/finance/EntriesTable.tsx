"use client";

import { useEffect, useState } from "react";
import { FinanceEntry } from "@/components/finance/types";
import { useCurrency } from "@/lib/use-currency";
import { normalizeCategoryName } from "@/lib/categoryName";
import { warmFetch } from "@/lib/prefetch";

/** Sentinel option value that opens the "new category" input. */
const NEW_CATEGORY = "__new__";

type EntriesTableProps = {
  entries: FinanceEntry[];
  /**
   * When provided, the category cell becomes an inline editor. Called after a
   * category is saved so the page can refresh its totals and charts, which are
   * grouped by category and would otherwise go stale.
   */
  onEntryUpdated?: () => void;
};

/**
 * Every entry it is handed, in a panel that scrolls. It used to cut the list at
 * ten rows unless the caller asked for all of them, which meant a month view
 * headed "47 entries" showed ten of them with no way to reach the rest. The
 * caller decides what belongs in the window; this renders the window.
 *
 * Chrome — the card, the heading, the count — belongs to the caller too, which
 * already draws all three.
 */
export function EntriesTable({ entries, onEntryUpdated }: EntriesTableProps) {
  const { formatPrice } = useCurrency();
  const editable = Boolean(onEntryUpdated);

  const [categories, setCategories] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shows the new category immediately, before the page refetches.
  const [edited, setEdited] = useState<Record<number, string>>({});
  // Entry whose cell is currently showing the "new category" input, and what
  // has been typed into it.
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");

  async function loadCategories() {
    const res = await warmFetch("/api/finance/categories", {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    setCategories((data.categories ?? []).map((c: { name: string }) => c.name));
  }

  useEffect(() => {
    if (!editable) return;
    // Non-fatal: the cell just stays read-only if the list never arrives.
    void (async () => {
      await loadCategories().catch(() => {});
    })();
  }, [editable]);

  function startCreating(entryId: number) {
    setCreatingFor(entryId);
    setDraftName("");
    setError(null);
  }

  function cancelCreating() {
    setCreatingFor(null);
    setDraftName("");
  }

  async function createAndAssign(entry: FinanceEntry) {
    const name = normalizeCategoryName(draftName);
    if (!name) return;

    setSavingId(entry.id);
    setError(null);

    try {
      const res = await fetch("/api/finance/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });

      // 200 means it already existed, which is fine — assign it either way.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create category");
      }

      cancelCreating();
      await loadCategories();
      await saveCategory(entry, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    } finally {
      setSavingId(null);
    }
  }

  async function saveCategory(entry: FinanceEntry, category: string) {
    if (category === (edited[entry.id] ?? entry.category)) return;

    setEdited((prev) => ({ ...prev, [entry.id]: category }));
    setSavingId(entry.id);
    setError(null);

    try {
      // The endpoint replaces the whole entry, so every field goes back with
      // only the category changed.
      const res = await fetch(`/api/finance/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product_name: entry.product_name,
          category,
          price: entry.price,
          purchase_date: new Date(entry.purchase_date).toISOString(),
          status: entry.status,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update category");
      }

      onEntryUpdated?.();
    } catch (err) {
      setEdited((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to update category");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="text-black dark:text-white">
      {error && (
        <p className="text-sm text-red-500 mb-3">{error}</p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">
          No entries found.
        </p>
      ) : (
        // A long month scrolls inside its own card rather than stretching the
        // page past the charts beside it. The header stays put while it does.
        <div className="overflow-x-auto overflow-y-auto max-h-[32rem]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              {/* The rule lives on the cells, not the row: Tailwind collapses
                  table borders, and a collapsed border on a sticky row is not
                  painted as it scrolls. */}
              <tr className="text-left text-muted">
                <th className="py-3 font-medium border-b border-default">Product</th>
                <th className="py-3 font-medium border-b border-default">Category</th>
                <th className="py-3 font-medium border-b border-default">Date</th>
                <th className="py-3 font-medium border-b border-default">Status</th>
                <th className="py-3 font-medium border-b border-default text-right">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-subtle last:border-0"
                >
                  <td className="py-3 font-medium">{entry.product_name}</td>
                  <td className="py-3 text-muted">
                    {!editable || categories.length === 0 ? (
                      entry.category
                    ) : creatingFor === entry.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={draftName}
                          placeholder="New category"
                          disabled={savingId === entry.id}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") createAndAssign(entry);
                            if (e.key === "Escape") cancelCreating();
                          }}
                          onBlur={(e) => {
                            // Keep the input alive when focus moves to Save.
                            if (!e.currentTarget.parentElement?.contains(
                              e.relatedTarget as Node | null
                            )) {
                              cancelCreating();
                            }
                          }}
                          className="-ml-2 w-32 rounded-md border border-strong bg-surface-raised px-2 py-0.5 text-sm text-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => createAndAssign(entry)}
                          disabled={
                            savingId === entry.id || !draftName.trim()
                          }
                          className="rounded-md border border-strong px-2 py-0.5 text-xs hover:bg-surface-hover disabled:opacity-50 transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      // Always a select, styled flat until hovered, so a single
                      // click opens the list.
                      <select
                        aria-label={`Category for ${entry.product_name}`}
                        value={edited[entry.id] ?? entry.category}
                        disabled={savingId === entry.id}
                        onChange={(e) =>
                          e.target.value === NEW_CATEGORY
                            ? startCreating(entry.id)
                            : saveCategory(entry, e.target.value)
                        }
                        // max-w keeps one unusually long category name from
                        // blowing out the column width.
                        className="-ml-2 max-w-[12rem] cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-0.5 text-sm text-muted hover:border-strong hover:bg-surface-raised focus:border-strong focus:bg-surface-raised focus:outline-none disabled:opacity-50 transition-colors"
                      >
                        {/* The entry's own category may have since been
                            deleted, so make sure it is always selectable. */}
                        {[
                          ...new Set([
                            edited[entry.id] ?? entry.category,
                            ...categories,
                          ]),
                        ].map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                        <option value={NEW_CATEGORY}>+ New category…</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 text-muted">
                    {new Date(entry.purchase_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        entry.status === "done"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono">
                    {formatPrice(entry.price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
