"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Stay } from "@/lib/types";
import { elapsedLabel } from "./presenceText";

/** The counter only shows minutes, so ticking faster would redraw nothing. */
const TICK_MS = 30_000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The stay the Namu app is counting, with a live "for 2 h 14 min". While a
 * departure waits out the re-entry window it says so instead: the stay is not
 * logged until the window passes, and coming back continues it.
 *
 * `action` sits at the right, e.g. the devices page's "End now" or the
 * dashboard's link to that page.
 */
export function StayBanner({ stay, action }: { stay: Stay; action?: ReactNode }) {
  const now = useNow();
  const departed = stay.departed_at !== null;

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 flex-wrap ${
        departed
          ? "bg-tint-amber-a border-tint-amber-line"
          : "bg-tint-green-a border-tint-green-line"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {!departed && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              departed ? "bg-amber-500" : "bg-green-500"
            }`}
          />
        </span>
        <div className="min-w-0">
          <p
            className={`text-sm font-medium truncate ${
              departed ? "text-tint-amber-ink" : "text-tint-green-ink"
            }`}
          >
            {departed
              ? `Left ${stay.place_name} at ${clockTime(stay.departed_at!)}`
              : `At ${stay.place_name} for ${elapsedLabel(stay.started_at, now)}`}
          </p>
          <p className="text-xs text-muted">
            {departed
              ? `Since ${clockTime(stay.started_at)}. Coming back within a few minutes continues this stay; otherwise it is logged.`
              : `Since ${clockTime(stay.started_at)}, counted by the Namu app.`}
          </p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
