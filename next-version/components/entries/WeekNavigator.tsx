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
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-4 rounded-xl shadow-sm border border-subtle">
      {/* Date Navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={showAll || showToday}
          className="p-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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

        <div className="px-4 py-2 rounded-lg bg-surface-inset min-w-[180px] text-center">
          <p className="text-sm font-semibold text-primary">
            {showToday
              ? "Today"
              : showAll
                ? "All Time"
                : `${formatDate(weekStart)} – ${formatDate(weekEnd)}`}
          </p>
          {!showToday && !showAll && (
            <p className="text-xs text-muted mt-0.5">
              {weekStart.getFullYear()}
            </p>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={showAll || showToday}
          className="p-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
      <div className="flex gap-1 p-1 rounded-lg bg-surface-inset">
        {(["today", "week", "all"] as FilterMode[]).map((mode) => {
          const isActive = filterMode === mode;
          const label = mode === "all" ? "All time" : mode.charAt(0).toUpperCase() + mode.slice(1);
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              onClick={() => onFilterModeChange(mode)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                isActive
                  ? "bg-surface-raised dark:bg-surface-hover text-primary shadow-sm"
                  : "text-muted hover:text-primary"
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
