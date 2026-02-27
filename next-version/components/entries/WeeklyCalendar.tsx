import { useMemo, memo } from "react";
import { Entry } from "@/components/entries/types";
import { stripTime, formatDuration } from "@/components/entries/utils";
import { getDarkEventColor } from "@/components/entries/colors";

type Segment = {
  segStart: Date;
  segEnd: Date;
  segDurationSeconds: number;
  topPct: number;
  heightPct: number;
};

type PackedEvent = {
  ev: Entry;
  seg: Segment;
  col: 0 | 1 | null;
  overlaps: boolean;
};

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
  isDark?: boolean;
  maxHeight?: number;
};

export const WeeklyCalendar = memo(function WeeklyCalendar({
  weekStart,
  entries,
  isDark = false,
  maxHeight,
}: WeeklyCalendarProps) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        d.setHours(0, 0, 0, 0);
        return d;
      }),
    [weekStart],
  );

  const entriesByDay = useMemo(() => {
    const byDay: Entry[][] = days.map(() => []);
    const weekStartTime = stripTime(weekStart).getTime();
    entries.forEach((entry) => {
      const d = stripTime(new Date(entry.start_time)).getTime();
      const idx = Math.round((d - weekStartTime) / (1000 * 60 * 60 * 24));
      if (idx >= 0 && idx < 7) byDay[idx].push(entry);
    });
    return byDay;
  }, [entries, days, weekStart]);

  const packedByDay = useMemo(
    () =>
      days.map((dayStart, idx) => assignColumns(entriesByDay[idx], dayStart)),
    [days, entriesByDay],
  );

  const eventColors = useMemo(() => {
    const colors: Record<number, string> = {};
    entries.forEach((ev) => {
      if (!colors[ev.id]) {
        colors[ev.id] = getDarkEventColor(ev.category);
      }
    });
    return colors;
  }, [entries]);

  const hourRange = useMemo(() => {
    if (entries.length === 0) return { min: 8, max: 22 };

    let minHour = 23;
    let maxHour = 0;

    entries.forEach((entry) => {
      const start = new Date(entry.start_time);
      const end = new Date(entry.end_time);
      minHour = Math.min(minHour, start.getHours());
      maxHour = Math.max(maxHour, end.getHours());
    });

    const defaultMin = 8;
    const defaultMax = 22;

    return {
      min: Math.min(minHour, defaultMin),
      max: Math.max(maxHour, defaultMax),
    };
  }, [entries]);

  const visibleHours = useMemo(() => {
    const hours: number[] = [];
    for (let h = hourRange.min; h <= hourRange.max; h++) {
      hours.push(h);
    }
    return hours;
  }, [hourRange]);

  const totalMinutes = (hourRange.max - hourRange.min + 1) * 60;

  const getAdjustedSegment = (seg: Segment) => {
    const startMinutes =
      seg.segStart.getHours() * 60 + seg.segStart.getMinutes();
    const endMinutes = seg.segEnd.getHours() * 60 + seg.segEnd.getMinutes();
    const rangeStartMinutes = hourRange.min * 60;
    const rangeEndMinutes = (hourRange.max + 1) * 60;

    const clampedStart = Math.max(startMinutes, rangeStartMinutes);
    const clampedEnd = Math.min(endMinutes, rangeEndMinutes);

    const topPct = ((clampedStart - rangeStartMinutes) / totalMinutes) * 100;
    const heightPct = Math.max(
      ((clampedEnd - clampedStart) / totalMinutes) * 100,
      1.5,
    );

    return { topPct, heightPct };
  };

  return (
    <div
      className="bg-bone dark:bg-neutral-900 p-3 md:p-4 rounded-xl shadow text-black dark:text-white overflow-hidden"
      style={
        maxHeight
          ? { maxHeight: `${maxHeight}px`, overflowY: "auto" }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base md:text-lg font-semibold">Weekly Calendar</h2>
        <span className="text-xs opacity-70">
          Displays the selected week (24h). Uses half-width on overlap.
        </span>
      </div>

      <div className="w-full text-center">
        <div className="w-full">
          <div
            className="grid"
            style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}
          >
            <div />
            {days.map((d, i) => (
              <div
                key={i}
                className="px-1 pb-2 text-xs md:text-sm font-semibold"
              >
                {d.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            ))}
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}
          >
            <div className="relative">
              {visibleHours.map((h) => (
                <div
                  key={h}
                  className="h-8 border-t border-neutral-300 dark:border-neutral-800 text-[10px] pr-1 text-right"
                >
                  <div className="-translate-y-2 opacity-70">
                    {h.toString().padStart(2, "0")}:00
                  </div>
                </div>
              ))}
              <div className="border-t border-neutral-300 dark:border-neutral-800" />
            </div>

            {days.map((dayStart, dayIdx) => {
              const packed = packedByDay[dayIdx];

              return (
                <div key={dayIdx} className="relative">
                  {visibleHours.map((h) => (
                    <div
                      key={h}
                      className="h-8 border-t border-neutral-300 dark:border-neutral-800"
                    />
                  ))}
                  <div className="border-t border-neutral-300 dark:border-neutral-800" />

                  <div className="absolute inset-0">
                    {packed
                      .sort(
                        (a, b) =>
                          a.seg.segStart.getTime() - b.seg.segStart.getTime(),
                      )
                      .map(({ ev, seg, col, overlaps }) => {
                        const layout = overlaps
                          ? {
                              width: "38%",
                              left: col === 0 ? "10%" : "52%",
                              right: "10%",
                            }
                          : { width: "80%", left: "10%", right: "10%" };

                        const darkColorClass = isDark ? eventColors[ev.id] : "";
                        const { topPct, heightPct } = getAdjustedSegment(seg);

                        return (
                          <div
                            key={ev.id}
                            className={`absolute rounded-md shadow-sm text-white text-xs p-1 ${isDark ? darkColorClass : "bg-green-600 border-green-800/40"}`}
                            style={{
                              top: `${topPct}%`,
                              height: `${heightPct}%`,
                              overflow: "hidden",
                              ...layout,
                            }}
                            title={`${ev.category} • ${formatDuration(seg.segDurationSeconds)}`}
                          >
                            <div className="font-semibold truncate mb-1">
                              {ev.category}
                            </div>
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
});
