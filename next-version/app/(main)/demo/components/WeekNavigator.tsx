import { addDays } from "../utils";

type WeekNavigatorProps = {
  weekStart: Date;
  weekEnd: Date;
  showAll: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleShowAll: () => void;
};

export function WeekNavigator({
  weekStart,
  weekEnd,
  showAll,
  onPrev,
  onNext,
  onToggleShowAll,
}: WeekNavigatorProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-bone dark:bg-neutral-900 p-3 rounded-xl shadow">
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          className="px-3 rounded bg-gray-200 dark:bg-neutral-700 disabled:opacity-50"
          disabled={showAll}
          title={showAll ? "Disable 'Show all' to navigate weeks" : "Previous week"}
        >
          ←
        </button>

        <div className="font-semibold text-center">
          Week of{" "}
          {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" – "}
          {weekEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>

        <button
          onClick={onNext}
          className="px-3 rounded bg-gray-200 dark:bg-neutral-700 disabled:opacity-50"
          disabled={showAll}
          title={showAll ? "Disable 'Show all' to navigate weeks" : "Next week"}
        >
          →
        </button>
      </div>

      <button
        type="button"
        aria-pressed={showAll}
        onClick={onToggleShowAll}
        className="inline-flex items-center gap-2 px-3 py-1 bg-neutral-700 rounded-full transition"
        title="Toggle between current week and all entries"
      >
        <span
          className={[
            "inline-block h-4 w-7 rounded-full relative transition",
            showAll ? "bg-green-500" : "bg-gray-400",
          ].join(" ")}
          aria-hidden="true"
        >
          <span
            className={[
              "absolute top-0.5 h-3 w-3 rounded-full bg-white transition",
              showAll ? "left-3.5" : "left-0.5",
            ].join(" ")}
          />
        </span>
        <span className="text-sm font-medium">
          {showAll ? "Show all" : "This week"}
        </span>
      </button>
    </div>
  );
}
