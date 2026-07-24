"use client";

import { useMemo } from "react";
import { formatDuration } from "./utils";

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time?: string;
};

type TodaySessionsProps = {
  entries: Entry[];
  /** Highlighted so the category being timed stands out in the list. */
  activeCategory?: string | null;
  loading?: boolean;
};

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TodaySessions({
  entries,
  activeCategory = null,
  loading = false,
}: TodaySessionsProps) {
  const today = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return entries
      .filter((e) => new Date(e.start_time) >= startOfDay)
      .sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      );
  }, [entries]);

  return (
    // min-h-0 lets the list shrink inside the stretched column instead of
    // pushing the card past the bottom of the grid row.
    <div className="h-full min-h-0 flex flex-col bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <div className="flex items-baseline justify-between gap-2 mb-3 flex-none">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Today's Sessions
        </h2>
        {today.length > 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
            {today.length}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : today.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Nothing logged yet today. Finish a session and it will show up here.
        </p>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 divide-y divide-gray-100 dark:divide-neutral-800">
          {today.map((entry) => {
            const active = entry.category === activeCategory;
            return (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p
                    className={`truncate font-medium ${
                      active
                        ? "text-gray-900 dark:text-gray-100"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {entry.category}
                  </p>
                  <p className="text-gray-400 dark:text-gray-500 tabular-nums">
                    {clockTime(entry.start_time)}
                    {entry.end_time ? ` – ${clockTime(entry.end_time)}` : ""}
                  </p>
                </div>
                <span
                  className={`tabular-nums flex-none ${
                    active
                      ? "text-green-600 dark:text-green-400 font-semibold"
                      : "text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {formatDuration(entry.duration_seconds)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
