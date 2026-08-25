export const TARGETS_STORAGE_KEY = "timerDailyTargets";
export const TIMER_STATE_KEY = "timerState";

export type TimerState = "idle" | "running" | "paused" | "stopped";

/**
 * One continuous stretch of tracked time. Pausing closes the current segment
 * and resuming opens a new one, so a session interrupted by lunch is stored
 * as the two intervals actually worked rather than one inflated block.
 * `end` is null only for the segment currently running.
 */
export type Segment = { start: string; end: string | null };

// ─── Time formatting ─────────────────────────────────────────────────────────

export function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** "8h 05m" / "45m" — for durations read at a glance. */
export function formatDuration(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

/**
 * Splits elapsed time into the part worth reading (hours:minutes) and the
 * seconds, which the display renders smaller so the clock stays scannable.
 */
export function splitClock(totalSecs: number): { hm: string; ss: string } {
  const s = Math.max(0, Math.floor(totalSecs));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    hm: `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`,
    ss: pad(s % 60),
  };
}

// ─── Segment math ────────────────────────────────────────────────────────────

export function segmentSeconds(segment: Segment, now: number): number {
  const start = parseDate(segment.start);
  if (!start) return 0;
  const end = segment.end ? parseDate(segment.end) : new Date(now);
  if (!end) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
}

export function totalSeconds(segments: Segment[], now: number): number {
  return segments.reduce((acc, seg) => acc + segmentSeconds(seg, now), 0);
}

/** A segment is submittable only once it is closed and moves forward in time. */
export function isSegmentValid(segment: Segment): boolean {
  const start = parseDate(segment.start);
  const end = parseDate(segment.end);
  return !!start && !!end && end.getTime() > start.getTime();
}

// ─── Daily targets (per category, browser-local) ──────────────────────────────

export function readTargets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch {
    // localStorage unavailable or corrupted — fall back to "no targets set".
    return {};
  }
}

export function writeTargets(targets: Record<string, number>) {
  try {
    localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets));
  } catch {
    // localStorage unavailable — targets just won't survive a refresh.
  }
}

/**
 * "today at 6:30 PM" / "tomorrow at 1:15 AM" / "Wed at 2:00 AM" — the wall
 * clock moment a countdown lands on, so a remaining duration can be read as
 * a time of day without doing the arithmetic. Times follow the browser locale
 * (12h or 24h).
 */
export function formatEta(finish: Date, now: Date): string {
  const time = finish.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const startOfFinish = new Date(finish).setHours(0, 0, 0, 0);
  // Rounded, not floored: on a DST boundary two adjacent day starts sit 23 or
  // 25 hours apart, which would otherwise read as the same day.
  const dayDiff = Math.round((startOfFinish - startOfToday) / 86_400_000);

  if (dayDiff <= 0) return `today at ${time}`;
  if (dayDiff === 1) return `tomorrow at ${time}`;
  if (dayDiff < 7) {
    return `${finish.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
  }
  return `${finish.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time}`;
}
