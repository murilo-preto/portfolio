import { Entry } from "../types";
import { stripTime, formatDuration } from "../utils";

type Segment = {
  segStart: Date;
  segEnd: Date;
  /** Duration of this day-segment in seconds */
  segDurationSeconds: number;
  topPct: number;
  heightPct: number;
};

type PackedEvent = {
  ev: Entry;
  seg: Segment;
  /** null = no overlap, 0 or 1 = column index */
  col: 0 | 1 | null;
  overlaps: boolean;
};

/** Clips an entry to the visible portion of a given day (00:00–23:59:59). */
function getSegment(entry: Entry, dayStart: Date): Segment | null {
  const start = new Date(entry.start_time);
  const end = new Date(entry.end_time);

  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  if (end < dayStart || start > dayEnd) return null;

  const segStart = start < dayStart ? dayStart : start;
  const segEnd = end > dayEnd ? dayEnd : end;

  const minFromMidnight = segStart.getHours() * 60 + segStart.getMinutes();
  const segDurationSeconds = (segEnd.getTime() - segStart.getTime()) / 1000;

  return {
    segStart,
    segEnd,
    segDurationSeconds,
    topPct: (minFromMidnight / 1440) * 100,
    heightPct: Math.max((segDurationSeconds / 86400) * 100, 0.8),
  };
}

/**
 * Assigns column indices (0 or 1) to overlapping events using a greedy
 * two-column packing algorithm. Non-overlapping events get col = null
 * and are rendered full-width.
 */
function assignColumns(dayEntries: Entry[], dayStart: Date): PackedEvent[] {
  const segs = dayEntries
    .map((ev) => ({ ev, seg: getSegment(ev, dayStart) }))
    .filter((x): x is { ev: Entry; seg: Segment } => x.seg !== null);

  segs.sort((a, b) => a.seg.segStart.getTime() - b.seg.segStart.getTime());

  const n = segs.length;
  const hasOverlap = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segs[j].seg.segStart >= segs[i].seg.segEnd) break;
      const overlapping =
        segs[i].seg.segStart < segs[j].seg.segEnd &&
        segs[j].seg.segStart < segs[i].seg.segEnd;
      if (overlapping) {
        hasOverlap[i] = true;
        hasOverlap[j] = true;
      }
    }
  }

  const packed: PackedEvent[] = [];
  const colEnd: (Date | null)[] = [null, null];

  for (let i = 0; i < n; i++) {
    const { ev, seg } = segs[i];

    if (!hasOverlap[i]) {
      packed.push({ ev, seg, col: null, overlaps: false });
      continue;
    }

    // Free a column if the previous event in it has ended
    if (colEnd[0] && colEnd[0] <= seg.segStart) colEnd[0] = null;
    if (colEnd[1] && colEnd[1] <= seg.segStart) colEnd[1] = null;

    const col: 0 | 1 = colEnd[0] && colEnd[0] > seg.segStart ? 1 : 0;
    colEnd[col] = seg.segEnd;
    packed.push({ ev, seg, col, overlaps: true });
  }

  return packed;
}

type WeeklyCalendarProps = {
  weekStart: Date;
  entries: Entry[];
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function WeeklyCalendar({ weekStart, entries }: WeeklyCalendarProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Group entries by day index within the week
  const entriesByDay: Entry[][] = days.map(() => []);
  entries.forEach((entry) => {
    const d = stripTime(new Date(entry.start_time));
    const idx = Math.round(
      (d.getTime() - stripTime(weekStart).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (idx >= 0 && idx < 7) entriesByDay[idx].push(entry);
  });

  return (
    <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Weekly Calendar</h2>
        <span className="text-xs opacity-70">
          Displays the selected week (24h). Uses half-width on overlap.
        </span>
      </div>

      <div className="w-full overflow-x-auto text-center">
        <div className="min-w-225">
          {/* Day headers */}
          <div className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
            <div />
            {days.map((d, i) => (
              <div key={i} className="px-2 pb-2 text-sm font-semibold">
                {d.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div className="grid" style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}>
            {/* Hour labels */}
            <div className="relative">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="h-16 border-t border-neutral-300 dark:border-neutral-800 text-xs pr-1 text-right"
                >
                  <div className="-translate-y-2 opacity-70">
                    {h.toString().padStart(2, "0")}:00
                  </div>
                </div>
              ))}
              <div className="border-t border-neutral-300 dark:border-neutral-800" />
            </div>

            {/* Day columns */}
            {days.map((dayStart, dayIdx) => {
              const packed = assignColumns(entriesByDay[dayIdx], dayStart);

              return (
                <div key={dayIdx} className="relative">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="h-16 border-t border-neutral-300 dark:border-neutral-800"
                    />
                  ))}
                  <div className="border-t border-neutral-300 dark:border-neutral-800" />

                  <div className="absolute inset-0">
                    {packed
                      .sort((a, b) => a.seg.segStart.getTime() - b.seg.segStart.getTime())
                      .map(({ ev, seg, col, overlaps }) => {
                        const layout = overlaps
                          ? { width: "38%", left: col === 0 ? "10%" : "52%", right: "10%" }
                          : { width: "80%", left: "10%", right: "10%" };

                        return (
                          <div
                            key={ev.id}
                            className="absolute rounded-md bg-green-600 dark:bg-cyan-600 border border-green-800/40 dark:border-cyan-300/60 shadow-sm text-white text-xs p-1"
                            style={{
                              top: `${seg.topPct}%`,
                              height: `${seg.heightPct}%`,
                              overflow: "hidden",
                              ...layout,
                            }}
                            title={`${ev.category} • ${formatDuration(seg.segDurationSeconds)}`}
                          >
                            <div className="font-semibold truncate mb-1">{ev.category}</div>
                            <div className="opacity-90 truncate">
                              {seg.segStart.toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })}
                              {" – "}
                              {seg.segEnd.toLocaleTimeString(undefined, {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              })}
                            </div>
                            <div className="opacity-90 truncate">
                              {formatDuration(seg.segDurationSeconds)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
