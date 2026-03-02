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

  function FilterButton({ mode, label }: { mode: FilterMode; label: string }) {
    const isActive = filterMode === mode;
    return (
      <button
        type="button"
        onClick={() => onFilterModeChange(mode)}
        className={`px-3 py-1 rounded-full text-sm font-medium transition ${
          isActive
            ? "bg-stone-700 dark:bg-blue-500 text-white"
            : "bg-gray-200 dark:bg-neutral-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-neutral-600"
        }`}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-bone dark:bg-neutral-900 p-3 rounded-xl shadow">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="px-3 rounded bg-gray-200 dark:bg-neutral-700 disabled:opacity-50"
          disabled={showAll || showToday}
          title={
            showAll || showToday
              ? `Disable '${showAll ? "Show all" : "Today"}' to navigate weeks`
              : "Previous week"
          }
        >
          ←
        </button>

        <div className="font-semibold text-center">
          {showToday
            ? "Today"
            : `Week of ${weekStart.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}${" – "}${weekEnd.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}`}
        </div>

        <button
          onClick={onNext}
          className="px-3 rounded bg-gray-200 dark:bg-neutral-700 disabled:opacity-50"
          disabled={showAll || showToday}
          title={
            showAll || showToday
              ? `Disable '${showAll ? "Show all" : "Today"}' to navigate weeks`
              : "Next week"
          }
        >
          →
        </button>
      </div>

      <div className="flex items-center gap-2">
        <FilterButton mode="today" label="Today" />
        <FilterButton mode="week" label="Week" />
        <FilterButton mode="all" label="All time" />
      </div>
    </div>
  );
}
