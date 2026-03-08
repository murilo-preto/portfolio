"use client";

import { useState } from "react";
import { addDays, getMondayOf } from "@/components/finance/utils";

type FilterMode = "today" | "week" | "all";

type WeekNavigatorProps = {
  weekStart: Date;
  weekEnd: Date;
  filterMode: FilterMode;
  onPrev: () => void;
  onNext: () => void;
  onFilterModeChange: (mode: FilterMode) => void;
};

export function WeekNavigator({
  weekStart,
  weekEnd,
  filterMode,
  onPrev,
  onNext,
  onFilterModeChange,
}: WeekNavigatorProps) {
  const today = new Date();
  const isThisWeek =
    today >= weekStart && today <= addDays(weekEnd, 1);

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={filterMode === "all" || isThisWeek}
          className="p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous period"
        >
          ←
        </button>
        <div className="px-4 py-2 rounded-lg bg-offwhite dark:bg-neutral-900 text-sm font-medium">
          {filterMode === "today"
            ? today.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : filterMode === "week"
              ? `${formatDate(weekStart)} - ${formatDate(weekEnd)}`
              : "All Time"}
        </div>
        <button
          onClick={onNext}
          disabled={filterMode === "all" || isThisWeek}
          className="p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Next period"
        >
          →
        </button>
      </div>

      <div className="flex gap-2">
        {(["today", "week", "all"] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => onFilterModeChange(mode)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterMode === mode
                ? "bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900"
                : "border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700"
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
