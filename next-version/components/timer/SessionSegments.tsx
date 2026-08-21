"use client";

import { useState } from "react";
import {
  formatDuration,
  isSegmentValid,
  segmentSeconds,
  toLocalDatetimeValue,
  type Segment,
  type TimerState,
} from "./utils";
import { useMediaQuery } from "@/lib/use-media-query";

type SessionSegmentsProps = {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
  state: TimerState;
};

// `color-scheme` themes the native calendar/spinner widgets — without it the
// picker renders light-on-dark and is unreadable in dark mode.
const INPUT_CLASS =
  "w-full px-3 py-2.5 rounded-lg border border-strong " +
  "bg-surface-raised text-primary text-sm " +
  "dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-green-500";

export function SessionSegments({
  segments,
  onChange,
  state,
}: SessionSegmentsProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");

  // Once a session is finished the times are about to be submitted, so this is
  // the moment they are worth checking — open the editor automatically. Not on
  // phones though: a stack of date pickers there would push Submit off-screen,
  // and the interval count in the summary is enough of an invitation.
  // Adjusting during render avoids a cascading extra render from an effect.
  const [prevState, setPrevState] = useState<TimerState | null>(null);
  if (prevState !== state) {
    setPrevState(state);
    if (state === "stopped" && isDesktop) setOpen(true);
  }

  function updateSegment(index: number, patch: Partial<Segment>) {
    onChange(segments.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)));
  }

  function removeSegment(index: number) {
    onChange(segments.filter((_, i) => i !== index));
  }

  function addSegment() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    onChange([
      ...segments,
      { start: hourAgo.toISOString(), end: now.toISOString() },
    ]);
    setOpen(true);
  }

  const multi = segments.length > 1;
  const summary = segments.length
    ? `${segments.length} interval${multi ? "s" : ""}`
    : "No time recorded yet";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-sm
                   text-secondary hover:text-gray-900
                   dark:hover:text-gray-100 transition-colors"
      >
        <span className="font-medium">Adjust times</span>
        <span className="flex items-center gap-2 text-xs text-dim">
          {summary}
          <svg
            className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {segments.length === 0 && (
            <p className="text-xs text-dim">
              Start the timer, or add an interval by hand if you forgot to.
            </p>
          )}

          {segments.map((segment, index) => {
            const openEnded = segment.end === null;
            const invalid = !openEnded && !isSegmentValid(segment);
            return (
              <div key={index} className="space-y-1.5">
                {multi && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted">
                      Interval {index + 1}
                      <span className="ml-2 font-normal text-dim tabular-nums">
                        {openEnded
                          ? "running"
                          : // Closed segments ignore the `now` argument, so no
                            // live clock is needed here.
                            formatDuration(segmentSeconds(segment, 0))}
                      </span>
                    </span>
                    {!openEnded && (
                      <button
                        type="button"
                        onClick={() => removeSegment(index)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors
                                   px-2 py-1.5 -mr-2 rounded-lg"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted">
                      Start
                    </label>
                    <input
                      type="datetime-local"
                      value={
                        segment.start
                          ? toLocalDatetimeValue(new Date(segment.start))
                          : ""
                      }
                      onChange={(e) => {
                        const parsed = new Date(e.target.value);
                        if (!isNaN(parsed.getTime())) {
                          updateSegment(index, { start: parsed.toISOString() });
                        }
                      }}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-muted">
                      End
                    </label>
                    <input
                      type="datetime-local"
                      disabled={openEnded}
                      value={
                        segment.end
                          ? toLocalDatetimeValue(new Date(segment.end))
                          : ""
                      }
                      onChange={(e) => {
                        const parsed = new Date(e.target.value);
                        if (!isNaN(parsed.getTime())) {
                          updateSegment(index, { end: parsed.toISOString() });
                        }
                      }}
                      className={`${INPUT_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`}
                    />
                  </div>
                </div>

                {invalid && (
                  <p className="text-xs text-red-500">
                    End must be after start.
                  </p>
                )}
              </div>
            );
          })}

          {state !== "running" && (
            <button
              type="button"
              onClick={addSegment}
              className="text-xs text-tint-blue-ink dark:text-blue-400 px-2.5 py-2 -ml-2.5
                         rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              + Add interval
            </button>
          )}
        </div>
      )}
    </div>
  );
}
