"use client";

import type { Category } from "@/lib/types";
import type { FocusPreferences } from "@/lib/preferences";

type FocusLoggingProps = {
  focus: FocusPreferences;
  categories: Category[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  onChange: (next: FocusPreferences) => void;
};

/**
 * Opt-in bridge from the Pomodoro screen to the time log.
 *
 * Without it, a day spent entirely in focus sessions shows as zero hours on
 * the entries dashboard — the numbers disagree and only manual reconciliation
 * reveals it. Turning this on makes each finished session write a matching
 * time entry, so the two screens describe the same day.
 */
export function FocusLogging({
  focus,
  categories,
  loading,
  error,
  saving,
  onChange,
}: FocusLoggingProps) {
  const enabled = focus.logToTimeEntries;
  // Enabling without a category would silently log nothing, so the toggle
  // adopts the first category as a starting point rather than a null one.
  const fallbackCategory = focus.category ?? categories[0]?.name ?? null;

  return (
    <div className="bg-surface p-4 rounded-xl shadow-sm border border-subtle">
      <h2 className="text-sm font-semibold text-primary mb-1">
        Log focus time
      </h2>
      <p className="text-xs text-muted mb-3">
        Write each finished pomodoro to your time entries, so the entries
        dashboard counts the time you spent here.
      </p>

      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              disabled={loading || saving || categories.length === 0}
              onChange={(e) =>
                onChange({
                  logToTimeEntries: e.target.checked,
                  category: e.target.checked ? fallbackCategory : focus.category,
                })
              }
              className="w-4 h-4 rounded border-strong accent-red-500"
            />
            <span className="text-sm text-secondary">
              Log completed sessions
            </span>
          </label>

          {enabled && (
            <div className="mt-3">
              <label
                htmlFor="focus-category"
                className="block text-xs text-muted mb-1"
              >
                Log under
              </label>
              <select
                id="focus-category"
                value={focus.category ?? ""}
                disabled={loading || saving}
                onChange={(e) =>
                  onChange({
                    logToTimeEntries: true,
                    category: e.target.value || null,
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
              >
                <option value="">Choose a category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {loading && (
            <p className="text-xs text-muted mt-2">Loading categories…</p>
          )}
          {!loading && categories.length === 0 && (
            <p className="text-xs text-muted mt-2">
              No time categories yet — create one on the{" "}
              <a href="/namu/user/categories" className="underline">
                categories page
              </a>{" "}
              first.
            </p>
          )}
          {saving && <p className="text-xs text-muted mt-2">Saving…</p>}
        </>
      )}
    </div>
  );
}
