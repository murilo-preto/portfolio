import { memo, useMemo, useState, type PointerEvent } from "react";
import { Entry } from "@/components/entries/types";
import { stripTime, formatDuration } from "@/components/entries/utils";
import { fallbackSlots, type ColorSlots } from "@/components/entries/colors";
import {
  DRAG_THRESHOLD_PX,
  MINUTES_PER_DAY,
  formatClock,
  rangeFromClick,
  rangeFromDrag,
  yToMinutes,
  type SlotRange,
} from "@/components/entries/calendarSelection";

type Segment = {
  segStart: Date;
  segEnd: Date;
  segDurationSeconds: number;
  topPct: number; // % from 00:00 over full day
  heightPct: number; // % of full day
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
    .filter((x): x is { ev: Entry; seg: Segment } => x.seg !== null)
    .sort((a, b) => a.seg.segStart.getTime() - b.seg.segStart.getTime());

  const n = segs.length;
  const hasOverlap = new Array<boolean>(n).fill(false);

  // Mark overlaps
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (segs[j].seg.segStart >= segs[i].seg.segEnd) break;
      const overlap =
        segs[i].seg.segStart < segs[j].seg.segEnd &&
        segs[j].seg.segStart < segs[i].seg.segEnd;
      if (overlap) {
        hasOverlap[i] = true;
        hasOverlap[j] = true;
      }
    }
  }

  // Pack into up to 2 columns for overlapping ones
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

/** A press in progress on one day column. */
type DragState = {
  dayIdx: number;
  anchorMin: number;
  currentMin: number;
  startY: number;
  moved: boolean;
};

function dragRange(drag: DragState) {
  return drag.moved
    ? rangeFromDrag(drag.anchorMin, drag.currentMin)
    : rangeFromClick(drag.anchorMin);
}

type WeeklyCalendarProps = {
  weekStart: Date;
  entries: Entry[];
  maxHeight?: number;
  /** Makes empty space selectable: a click reports a 30-minute slot, a drag
   *  the range it covered. Omit it and the calendar is display-only. */
  onSelectRange?: (range: SlotRange) => void;
  /** A selection awaiting confirmation, kept on screen as a ghost block. */
  pendingRange?: SlotRange | null;
  /** The page's category → colour map, shared with its charts. */
  colorSlots?: ColorSlots;
};

export const WeeklyCalendar = memo(function WeeklyCalendar({
  weekStart,
  entries,
  maxHeight,
  onSelectRange,
  pendingRange = null,
  colorSlots,
}: WeeklyCalendarProps) {
  const [drag, setDrag] = useState<DragState | null>(null);

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
    for (const entry of entries) {
      const d = stripTime(new Date(entry.start_time)).getTime();
      const idx = Math.round((d - weekStartTime) / 86400000);
      if (idx >= 0 && idx < 7) byDay[idx].push(entry);
    }
    return byDay;
  }, [entries, days, weekStart]);

  const packedByDay = useMemo(
    () =>
      days.map((dayStart, idx) => assignColumns(entriesByDay[idx], dayStart)),
    [days, entriesByDay],
  );

  // Each event is painted from its category's `--chart-N` slot, so the
  // calendar follows the theme and dark style with no re-render of its own.
  // The slot comes from the page's map, the one its charts use too.
  const slots = useMemo(
    () => colorSlots ?? fallbackSlots(entries.map((e) => e.category)),
    [colorSlots, entries],
  );

  // Fixed 24h scale
  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  // The ghost follows the live drag; once released it tracks the pending
  // selection instead, which the dialog may have edited since.
  const ghost = useMemo(() => {
    if (drag) return { dayIdx: drag.dayIdx, ...dragRange(drag) };
    if (!pendingRange || pendingRange.endMin <= pendingRange.startMin) {
      return null;
    }
    const dayIdx = days.findIndex(
      (d) => d.getTime() === pendingRange.day.getTime(),
    );
    if (dayIdx === -1) return null;
    return { dayIdx, ...pendingRange };
  }, [drag, pendingRange, days]);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>, dayIdx: number) {
    if (!onSelectRange || !e.isPrimary || e.button !== 0) return;
    // Existing entries are not a place to start a new one.
    if ((e.target as Element).closest("[data-entry]")) return;

    // Capture keeps the moves and the release coming here even when the
    // pointer leaves the column. On touch, a swipe that turns into a scroll
    // still ends in pointercancel, so the page scrolls as it always did.
    e.currentTarget.setPointerCapture(e.pointerId);
    const min = yToMinutes(e.clientY, e.currentTarget.getBoundingClientRect());
    setDrag({
      dayIdx,
      anchorMin: min,
      currentMin: min,
      startY: e.clientY,
      moved: false,
    });
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>, dayIdx: number) {
    if (!drag || drag.dayIdx !== dayIdx) return;
    const currentMin = yToMinutes(
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
    );
    const moved =
      drag.moved || Math.abs(e.clientY - drag.startY) >= DRAG_THRESHOLD_PX;
    setDrag({ ...drag, currentMin, moved });
  }

  function handlePointerUp(dayIdx: number) {
    if (!drag || drag.dayIdx !== dayIdx) return;
    setDrag(null);
    onSelectRange?.({ day: days[dayIdx], ...dragRange(drag) });
  }

  return (
    <div
      className="h-full bg-surface p-3 md:p-4 rounded-xl shadow-md border border-default text-primary overflow-hidden"
      style={
        maxHeight
          ? { maxHeight: `${maxHeight}px`, overflowY: "auto" }
          : undefined
      }
    >
      {entries.length === 0 && (
        <p className="text-xs text-muted text-center pb-2">
          No entries in this period.
        </p>
      )}

      <div className="w-full text-center">
        <div className="w-full">
          {/* Header row: day labels */}
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
                  month: "numeric",
                  day: "numeric",
                })}
              </div>
            ))}
          </div>

          {/* Body: hour rulers + day columns */}
          <div
            className="grid"
            style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}
          >
            {/* Left hour gutter */}
            <div className="relative">
              {hours.map((h) => (
                <div
                  key={h}
                  className="h-8 border-t border-subtle text-[10px] pr-1 text-right"
                >
                  <div className="-translate-y-2 opacity-70">
                    {h.toString().padStart(2, "0")}:00
                  </div>
                </div>
              ))}
              <div className="border-t border-subtle" />
            </div>

            {/* 7 day columns */}
            {days.map((_, dayIdx) => {
              const packed = packedByDay[dayIdx];
              return (
                <div
                  key={dayIdx}
                  className={`relative ${onSelectRange ? "cursor-crosshair select-none" : ""}`}
                  onPointerDown={(e) => handlePointerDown(e, dayIdx)}
                  onPointerMove={(e) => handlePointerMove(e, dayIdx)}
                  onPointerUp={() => handlePointerUp(dayIdx)}
                  onPointerCancel={() => setDrag(null)}
                >
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="h-8 border-t border-subtle"
                    />
                  ))}
                  <div className="border-t border-subtle" />

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

                        const topPct = seg.topPct;
                        const heightPct = Math.max(seg.heightPct, 0.8);
                        const slot = slots.get(ev.category) ?? 1;

                        return (
                          <div
                            key={ev.id}
                            data-entry
                            className="cursor-default absolute rounded-md shadow-sm text-xs p-1 content-center-safe"
                            style={{
                              backgroundColor: `var(--chart-${slot})`,
                              color: "var(--chart-on)",
                              top: `${topPct}%`,
                              height: `${heightPct}%`,
                              overflow: "hidden",
                              ...layout,
                            }}
                            title={`${ev.category} • ${seg.segStart.toLocaleTimeString(
                              undefined,
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              },
                            )} – ${seg.segEnd.toLocaleTimeString(undefined, {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })} • ${formatDuration(seg.segDurationSeconds)}`}
                          >
                            <div className="font-semibold text-clip mb-1">
                              {ev.category}
                            </div>
                            <div className="opacity-90 truncate">
                              {formatDuration(seg.segDurationSeconds)}
                            </div>
                          </div>
                        );
                      })}

                    {ghost && ghost.dayIdx === dayIdx && (
                      <div
                        className="absolute left-[4%] right-[4%] rounded-md border-2 border-dashed border-strong bg-surface-hover/70 text-primary text-[10px] leading-tight px-1 pointer-events-none overflow-hidden shadow-sm"
                        style={{
                          top: `${(ghost.startMin / MINUTES_PER_DAY) * 100}%`,
                          height: `${((ghost.endMin - ghost.startMin) / MINUTES_PER_DAY) * 100}%`,
                        }}
                      >
                        <div className="font-semibold truncate">
                          {formatClock(ghost.startMin)}–
                          {formatClock(ghost.endMin)}
                        </div>
                        <div className="opacity-80 truncate">
                          {formatDuration((ghost.endMin - ghost.startMin) * 60)}
                        </div>
                      </div>
                    )}
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
