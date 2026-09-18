/**
 * Pointer-to-time maths for creating entries on the weekly calendar.
 *
 * Everything is in minutes from local midnight of one day, 0–1440, so a
 * selection never straddles two columns. Kept free of the DOM so it can be
 * tested under the node-environment Vitest config.
 */

export const MINUTES_PER_DAY = 1440;
/** Both edges of a selection land on this grid. */
export const SNAP_MINUTES = 15;
/** A click without a drag creates an entry this long. */
export const CLICK_MINUTES = 30;
/** Pointer travel below this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** A selected slot: `day` is local midnight, the bounds are minutes into it. */
export type SlotRange = {
  day: Date;
  startMin: number;
  endMin: number;
};

type MinuteRange = { startMin: number; endMin: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** The snap slot a raw minute falls in, kept clear of 24:00 so a slot that
 *  starts there still has room to end. */
function slotOf(min: number): number {
  return clamp(
    Math.floor(min / SNAP_MINUTES) * SNAP_MINUTES,
    0,
    MINUTES_PER_DAY - SNAP_MINUTES,
  );
}

/** Raw minute under the pointer, from its offset into a day column. */
export function yToMinutes(
  clientY: number,
  rect: { top: number; height: number },
): number {
  if (rect.height <= 0) return 0;
  return clamp(
    ((clientY - rect.top) / rect.height) * MINUTES_PER_DAY,
    0,
    MINUTES_PER_DAY,
  );
}

/**
 * Range covered by a drag from `anchorMin` to `currentMin`, in either
 * direction. The slot the drag started in is always included, the moving edge
 * rounds to the nearest grid line, and the result is at least one slot long.
 */
export function rangeFromDrag(anchorMin: number, currentMin: number): MinuteRange {
  const anchorSlot = slotOf(anchorMin);
  const moving = clamp(
    Math.round(currentMin / SNAP_MINUTES) * SNAP_MINUTES,
    0,
    MINUTES_PER_DAY,
  );

  if (currentMin >= anchorMin) {
    return {
      startMin: anchorSlot,
      endMin: Math.max(moving, anchorSlot + SNAP_MINUTES),
    };
  }
  return {
    startMin: Math.min(moving, anchorSlot),
    endMin: anchorSlot + SNAP_MINUTES,
  };
}

/** Range a plain click creates: the slot under the pointer plus the default
 *  length, cut short at midnight rather than spilling into the next day. */
export function rangeFromClick(min: number): MinuteRange {
  const startMin = slotOf(min);
  return {
    startMin,
    endMin: Math.min(startMin + CLICK_MINUTES, MINUTES_PER_DAY),
  };
}

/** Local time `min` minutes into `day`; 1440 is the following midnight.
 *  Goes through `setHours` so a DST day still lands on the wall-clock time. */
export function minutesToDate(day: Date, min: number): Date {
  const d = new Date(day);
  d.setHours(0, min, 0, 0);
  return d;
}

/** "HH:MM" for a minute of the day; 1440 renders as "24:00". */
export function formatClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parses an `<input type="time">` value into minutes, or null if empty. */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
