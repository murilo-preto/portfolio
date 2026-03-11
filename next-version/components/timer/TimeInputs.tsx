"use client";

type TimeInputsProps = {
  startInput: string;
  endInput: string;
  durationSeconds: number | null;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
};

export function TimeInputs({
  startInput,
  endInput,
  durationSeconds,
  onStartChange,
  onEndChange,
}: TimeInputsProps) {
  const formatElapsed = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  return (
    <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
        Adjust Times
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Start Time */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Start Time
          </label>
          <input
            type="datetime-local"
            value={startInput}
            onChange={(e) => onStartChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-neutral-600 
                       bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 
                       text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* End Time */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            End Time
          </label>
          <input
            type="datetime-local"
            value={endInput}
            onChange={(e) => onEndChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-neutral-600 
                       bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 
                       text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
      </div>

      {/* Duration Display */}
      {durationSeconds !== null && (
        <div
          className={`mt-4 p-3 rounded-lg flex items-center justify-between ${
            durationSeconds > 0
              ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
          }`}
        >
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Duration
          </span>
          <span
            className={`text-lg font-bold ${
              durationSeconds > 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatElapsed(Math.max(0, durationSeconds))}
          </span>
        </div>
      )}

      {/* Validation Warning */}
      {durationSeconds !== null && durationSeconds <= 0 && (
        <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          End time must be after start time
        </p>
      )}
    </div>
  );
}
