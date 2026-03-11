"use client";

import { addDays } from "@/components/finance/utils";

type FilterMode = "today" | "week" | "month" | "all";

type WeekNavigatorProps = {
  weekStart: Date;
  weekEnd: Date;
  monthStart?: Date;
  monthEnd?: Date;
  filterMode: FilterMode;
  onPrev: () => void;
  onNext: () => void;
  onFilterModeChange: (mode: FilterMode) => void;
};

export function WeekNavigator({
  weekStart,
  weekEnd,
  monthStart,
  monthEnd,
  filterMode,
  onPrev,
  onNext,
  onFilterModeChange,
}: WeekNavigatorProps) {
  const today = new Date();

  // Only disabled when "all" mode is selected
  const isDisabled = filterMode === "all";

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const filterModes: FilterMode[] = ["today", "week", "month", "all"];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={isDisabled}
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
              : filterMode === "month"
                ? monthStart?.toLocaleDateString(undefined, { month: "long", year: "numeric" })
                : "All Time"}
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={isDisabled}
          className="p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Next period"
        >
          →
        </button>
      </div>

      <div className="flex gap-2">
        {filterModes.map((mode) => (
          <button
            key={mode}
            type="button"
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
