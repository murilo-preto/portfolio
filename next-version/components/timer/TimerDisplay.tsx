"use client";

import { splitClock, type TimerState } from "./utils";

type TimerDisplayProps = {
  elapsed: number;
  state: TimerState;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  disabled: boolean;
  /** Shown on the primary button when it is disabled, so it isn't a dead end. */
  disabledReason?: string;
  /** 0–1 progress toward today's target for the selected category. */
  progress: number;
  hasTarget: boolean;
  targetMet: boolean;
  /** e.g. "4h 50m" — time still owed to today's target, or the overshoot. */
  remainingLabel?: string;
  /** e.g. "today at 6:30 PM" — the clock time the target lands on. */
  etaLabel?: string;
};

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const STATUS_LABEL: Record<TimerState, string> = {
  idle: "Idle",
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
};

export function TimerDisplay({
  elapsed,
  state,
  onStart,
  onPause,
  onResume,
  onStop,
  disabled,
  disabledReason,
  progress,
  hasTarget,
  targetMet,
  remainingLabel,
  etaLabel,
}: TimerDisplayProps) {
  const { hm, ss } = splitClock(elapsed);
  const isRunning = state === "running";
  const isPaused = state === "paused";
  const isStopped = state === "stopped";

  const timeColor = isRunning
    ? "text-tint-green-ink"
    : isPaused
      ? "text-tint-amber-ink"
      : isStopped
        ? "text-secondary"
        : "text-gray-400 dark:text-gray-600";

  return (
    <div className="h-full flex flex-col justify-center bg-surface p-5 md:p-8 rounded-xl shadow-sm border border-subtle">
      {/* Ring + elapsed time, with today's target stats alongside. The stats
          sit outside the ring so the clock itself stays the one thing read
          first; they drop below it when there is no room to the side. */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-8">
        <div className="relative w-full max-w-[210px] sm:max-w-[260px] shrink-0 aspect-square">
          <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
            <circle
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              strokeWidth="8"
              className="stroke-subtle"
            />
            {hasTarget && (
              <circle
                cx="100"
                cy="100"
                r={RADIUS}
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                className={
                  targetMet
                    ? "stroke-green-500 transition-[stroke-dashoffset] duration-700"
                    : "stroke-blue-500 transition-[stroke-dashoffset] duration-700"
                }
              />
            )}
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {/* Digits update every second: announcing them would flood a screen
                reader, so the status line below carries the live updates. */}
            <div
              aria-hidden="true"
              className={`font-mono font-bold tracking-tight transition-colors ${timeColor}`}
            >
              <span className="text-4xl sm:text-5xl tabular-nums">{hm}</span>
              <span className="text-xl sm:text-2xl tabular-nums opacity-60 ml-1">
                {ss}
              </span>
            </div>

            <p
              aria-live="polite"
              className="text-[11px] text-muted uppercase tracking-widest mt-2"
            >
              {isRunning ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  Running
                </span>
              ) : (
                STATUS_LABEL[state]
              )}
            </p>
          </div>
        </div>

        {hasTarget && (remainingLabel || etaLabel) && (
          <dl className="flex sm:flex-col items-center sm:items-start gap-8 sm:gap-5 text-center sm:text-left">
            {remainingLabel && (
              <div>
                <dt className="text-[11px] uppercase tracking-widest text-dim">
                  {targetMet ? "Over target" : "Left today"}
                </dt>
                <dd
                  className={`mt-1 text-xl font-semibold tabular-nums ${
                    targetMet
                      ? "text-tint-green-ink dark:text-green-400"
                      : "text-secondary"
                  }`}
                >
                  {remainingLabel}
                </dd>
              </div>
            )}

            {etaLabel && (
              <div
                title={
                  isRunning
                    ? "When today's target is reached if the timer keeps running"
                    : "When today's target would be reached if the timer started now"
                }
              >
                <dt className="text-[11px] uppercase tracking-widest text-dim">
                  Finishes
                </dt>
                <dd className="mt-1 text-sm font-medium text-muted tabular-nums">
                  {etaLabel}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        {state === "idle" && (
          <button
            onClick={onStart}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="col-span-2 py-4 rounded-xl bg-green-500 hover:bg-green-600
                       disabled:bg-surface-muted disabled:text-dim
                       disabled:cursor-not-allowed
                       text-white font-semibold text-lg transition active:scale-95
                       disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            {!disabled && (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
            {disabled ? (disabledReason ?? "Start Timer") : "Start Timer"}
          </button>
        )}

        {isRunning && (
          <>
            <button
              onClick={onPause}
              className="py-4 rounded-xl border border-default
                         text-gray-700 dark:text-gray-200 font-semibold text-lg
                         hover:bg-surface-inset transition active:scale-95
                         flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
              Pause
            </button>
            <button
              onClick={onStop}
              className="py-4 rounded-xl bg-red-500 hover:bg-red-600 text-white
                         font-semibold text-lg transition active:scale-95
                         flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
              Finish
            </button>
          </>
        )}

        {isPaused && (
          <>
            <button
              onClick={onResume}
              className="py-4 rounded-xl bg-green-500 hover:bg-green-600 text-white
                         font-semibold text-lg transition active:scale-95
                         flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Resume
            </button>
            <button
              onClick={onStop}
              className="py-4 rounded-xl bg-red-500 hover:bg-red-600 text-white
                         font-semibold text-lg transition active:scale-95
                         flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
              Finish
            </button>
          </>
        )}

        {isStopped && (
          <button
            onClick={onStart}
            disabled={disabled}
            className="col-span-2 py-3 rounded-xl border border-default
                       text-gray-700 dark:text-gray-200 font-medium
                       hover:bg-surface-inset transition active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Start new session
          </button>
        )}
      </div>

      {/* Keyboard shortcuts — no keyboard on a phone, and hidden while the
          primary action is unavailable */}
      <p
        className={`hidden sm:block text-xs text-gray-400 dark:text-gray-500 text-center mt-4 ${
          disabled && state === "idle" ? "invisible" : ""
        }`}
      >
        <kbd className="px-1.5 py-0.5 rounded bg-surface-muted font-mono">
          Space
        </kbd>{" "}
        {isRunning ? "pause" : isPaused ? "resume" : "start"}
        {(isRunning || isPaused) && (
          <>
            {" · "}
            <kbd className="px-1.5 py-0.5 rounded bg-surface-muted font-mono">
              S
            </kbd>{" "}
            finish
          </>
        )}
      </p>
    </div>
  );
}
