"use client";

type TimeInputsProps = {
  startInput: string;
  endInput: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
};

export function TimeInputs({
  startInput,
  endInput,
  onStartChange,
  onEndChange,
}: TimeInputsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
  );
}
