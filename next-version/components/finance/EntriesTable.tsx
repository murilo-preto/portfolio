"use client";

import { useEffect, useState } from "react";
import { FinanceEntry } from "@/components/finance/types";
import { formatPrice } from "@/components/finance/utils";
import { normalizeCategoryName } from "@/lib/categoryName";

/** Sentinel option value that opens the "new category" input. */
const NEW_CATEGORY = "__new__";

type FinanceCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
};

export function Card({ title, value, subtitle }: FinanceCardProps) {
  return (
    <div className="bg-surface p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wide">
        {title}
      </h3>
      <p className="text-2xl md:text-3xl font-bold mt-2">{value}</p>
      {subtitle && (
        <p className="text-xs text-dim mt-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}

type EntriesTableProps = {
  entries: FinanceEntry[];
  showAll?: boolean;
  /**
   * When provided, the category cell becomes an inline editor. Called after a
   * category is saved so the page can refresh its totals and charts, which are
   * grouped by category and would otherwise go stale.
   */
  onEntryUpdated?: () => void;
};

export function EntriesTable({
  entries,
  showAll = false,
  onEntryUpdated,
}: EntriesTableProps) {
  const displayEntries = showAll ? entries : entries.slice(0, 10);
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
    const res = await fetch("/api/finance/categories", {
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    setCategories((data.categories ?? []).map((c: { name: string }) => c.name));
  }

  useEffect(() => {
    if (!editable) return;
    // Non-fatal: the cell just stays read-only if the list never arrives.
    loadCategories().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="bg-surface p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {showAll ? "All Entries" : "Recent Entries"}
        </h2>
        {showAll && (
          <span className="text-xs text-muted">
            {entries.length} entries
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 mb-3">{error}</p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">
          No entries found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-default">
                <th className="pb-3 font-medium">Product</th>
                <th className="pb-3 font-medium">Category</th>
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {displayEntries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-subtle last:border-0"
                >
                  <td className="py-3 font-medium">{entry.product_name}</td>
                  <td className="py-3 text-muted">
                    {!editable || entry.is_recurring || categories.length === 0 ? (
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
