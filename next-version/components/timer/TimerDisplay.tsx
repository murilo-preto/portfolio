"use client";

type TimerDisplayProps = {
  elapsed: number;
  isRunning: boolean;
  isStopped: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled: boolean;
};

export function TimerDisplay({
  elapsed,
  isRunning,
  isStopped,
  onStart,
  onStop,
  disabled,
}: TimerDisplayProps) {
  const formatElapsed = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  return (
    <div className="bg-white dark:bg-neutral-900 p-6 md:p-8 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Timer Display */}
      <div className="text-center mb-6">
        <div
          className={`font-mono text-5xl sm:text-6xl md:text-7xl font-bold tracking-widest transition-colors ${
            isRunning
              ? "text-green-500"
              : isStopped
                ? "text-gray-700 dark:text-gray-300"
                : "text-gray-400 dark:text-gray-600"
          }`}
        >
          {formatElapsed(elapsed)}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest mt-3">
          {isRunning ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Running
            </span>
          ) : isStopped ? (
            "Stopped"
          ) : (
            "Idle"
          )}
        </p>
      </div>

      {/* Start/Stop Buttons */}
      <div className="grid grid-cols-2 gap-3">
        {!isRunning ? (
          <button
            onClick={onStart}
            disabled={disabled}
            className="col-span-2 py-4 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed
                       text-white font-semibold text-lg transition active:scale-95 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isStopped ? "Restart" : "Start Timer"}
          </button>
        ) : (
          <>
            <button
              onClick={onStop}
              className="col-span-2 py-4 rounded-xl bg-red-500 hover:bg-red-600
                         text-white font-semibold text-lg transition active:scale-95 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
              Stop Timer
            </button>
          </>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">
        Press <kbd className="px-2 py-0.5 rounded bg-gray-100 dark:bg-neutral-800 font-mono">Space</kbd> to{" "}
        {isRunning ? "stop" : "start"}
      </p>
    </div>
  );
}
