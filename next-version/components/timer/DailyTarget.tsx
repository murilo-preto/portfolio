"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "./utils";

// Presets offered when picking a target, in seconds.
const PRESETS = [4 * 3600, 6 * 3600, 8 * 3600];

type DailyTargetProps = {
  categoryName: string;
  /** Target in seconds, or undefined when none is set for this category. */
  target: number | undefined;
  onSetTarget: (seconds: number) => void;
  onClearTarget: () => void;
  /** Time already saved to entries today for this category. */
  loggedSeconds: number;
  /** Current, not-yet-submitted session (running, paused or stopped). */
  liveSeconds: number;
  loading?: boolean;
};

export function DailyTarget({
  categoryName,
  target,
  onSetTarget,
  onClearTarget,
  loggedSeconds,
  liveSeconds,
  loading = false,
}: DailyTargetProps) {
  const [editing, setEditing] = useState(false);
  const [draftH, setDraftH] = useState("8");
  const [draftM, setDraftM] = useState("0");

  // Always show the stored target for whatever category is now selected.
  useEffect(() => {
    setEditing(false);
  }, [categoryName]);

  const done = loggedSeconds + liveSeconds;
  const remaining = (target ?? 0) - done;
  const metTarget = target != null && remaining <= 0;

  function startEditing() {
    const current = target ?? 8 * 3600;
    setDraftH(String(Math.floor(current / 3600)));
    setDraftM(String(Math.floor((current % 3600) / 60)));
    setEditing(true);
  }

  function saveDraft() {
    const h = Math.min(24, Math.max(0, Number(draftH) || 0));
    const m = Math.min(59, Math.max(0, Number(draftM) || 0));
    const seconds = Math.floor(h) * 3600 + Math.floor(m) * 60;
    if (seconds <= 0) return;
    onSetTarget(seconds);
    setEditing(false);
  }

  const showEditor = editing || target == null;

  return (
    <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Remaining
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-300 truncate max-w-[60%]">
          {categoryName}
        </span>
      </div>

      {showEditor ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Daily target for {categoryName}
          </p>

          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Hours
              </span>
              <input
                type="number"
                min={0}
                max={24}
                value={draftH}
                onChange={(e) => setDraftH(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveDraft()}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600
                           bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Minutes
              </span>
              <input
                type="number"
                min={0}
                max={59}
                step={5}
                value={draftM}
                onChange={(e) => setDraftM(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveDraft()}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600
                           bg-white dark:bg-neutral-800 text-gray-900 dark:text-gray-100 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  onSetTarget(preset);
                  setEditing(false);
                }}
                className="text-xs px-3.5 py-2 rounded-full border border-gray-300 dark:border-neutral-700
                           text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800
                           transition-colors"
              >
                {formatDuration(preset)}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-blue-600
                         hover:bg-blue-700 transition active:scale-95"
            >
              Save target
            </button>
            {target != null && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300
                           border border-gray-300 dark:border-neutral-700
                           hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className={`p-3 rounded-lg border ${
              metTarget
                ? "bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20"
                : "bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20"
            }`}
          >
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {metTarget ? "Target met — overtime" : "Left to work"}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
              {loading ? "—" : formatDuration(Math.abs(remaining))}
            </p>
          </div>

          <dl className="space-y-1.5 text-xs tabular-nums">
            <div className="flex justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Logged today</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {loading ? "—" : formatDuration(loggedSeconds)}
              </dd>
            </div>
            {liveSeconds > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500 dark:text-gray-400">
                  This session
                </dt>
                <dd className="text-green-600 dark:text-green-400">
                  +{formatDuration(liveSeconds)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-100 dark:border-neutral-800 pt-1.5">
              <dt className="text-gray-500 dark:text-gray-400">Target</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {formatDuration(target)}
              </dd>
            </div>
          </dl>

          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={startEditing}
              className="px-2.5 py-2 -ml-2.5 rounded-lg text-blue-600 dark:text-blue-400
                         hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              Edit target
            </button>
            <button
              type="button"
              onClick={onClearTarget}
              className="px-2.5 py-2 rounded-lg text-gray-400 dark:text-gray-500
                         hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
