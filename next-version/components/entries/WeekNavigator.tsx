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
  const showAll = filterMode === "all";
  const showToday = filterMode === "today";

  const formatDate = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Date Navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={showAll || showToday}
          className="p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous period"
          title={
            showAll || showToday
              ? `Disable '${showAll ? "Show all" : "Today"}' to navigate`
              : "Previous period"
          }
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="px-4 py-2 rounded-lg bg-gray-50 dark:bg-neutral-800 min-w-[180px] text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {showToday
              ? "Today"
              : showAll
                ? "All Time"
                : `${formatDate(weekStart)} – ${formatDate(weekEnd)}`}
          </p>
          {!showToday && !showAll && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {weekStart.getFullYear()}
            </p>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={showAll || showToday}
          className="p-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Next period"
          title={
            showAll || showToday
              ? `Disable '${showAll ? "Show all" : "Today"}' to navigate`
              : "Next period"
          }
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Filter Mode Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-neutral-800">
        {(["today", "week", "all"] as FilterMode[]).map((mode) => {
          const isActive = filterMode === mode;
          const label = mode === "all" ? "All time" : mode.charAt(0).toUpperCase() + mode.slice(1);
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onFilterModeChange(mode)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                isActive
                  ? "bg-white dark:bg-neutral-700 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
