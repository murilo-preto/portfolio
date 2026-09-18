/**
 * Pointer-to-time maths behind click/drag entry creation on the weekly
 * calendar. Pure functions, so no DOM is needed — the column's bounding rect is
 * passed in as a plain object.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatClock,
  minutesToDate,
  parseClock,
  rangeFromClick,
  rangeFromDrag,
  yToMinutes,
} from "@/components/entries/calendarSelection";

// 24 rows of 32px, as rendered.
const COLUMN = { top: 100, height: 768 };
const at = (hh: number, mm = 0) => hh * 60 + mm;

describe("yToMinutes", () => {
  it("maps the column's height onto the day", () => {
    expect(yToMinutes(100, COLUMN)).toBe(0);
    expect(yToMinutes(100 + 384, COLUMN)).toBe(at(12));
    expect(yToMinutes(100 + 768, COLUMN)).toBe(at(24));
  });

  it("clamps a pointer captured outside the column", () => {
    expect(yToMinutes(0, COLUMN)).toBe(0);
    expect(yToMinutes(5000, COLUMN)).toBe(at(24));
  });
});

describe("rangeFromClick", () => {
  it("starts at the 15-minute slot under the pointer and lasts 30 minutes", () => {
    expect(rangeFromClick(at(9, 7))).toEqual({
      startMin: at(9),
      endMin: at(9, 30),
    });
    expect(rangeFromClick(at(9, 22))).toEqual({
      startMin: at(9, 15),
      endMin: at(9, 45),
    });
  });

  it("stops at midnight instead of spilling into the next day", () => {
    expect(rangeFromClick(at(23, 50))).toEqual({
      startMin: at(23, 45),
      endMin: at(24),
    });
  });

  it("treats the very bottom edge as the last slot", () => {
    expect(rangeFromClick(at(24))).toEqual({
      startMin: at(23, 45),
      endMin: at(24),
    });
  });
});

describe("rangeFromDrag", () => {
  it("floors the anchor and rounds the moving edge on a downward drag", () => {
    expect(rangeFromDrag(at(9, 10), at(10, 8))).toEqual({
      startMin: at(9),
      endMin: at(10, 15),
    });
    expect(rangeFromDrag(at(9, 10), at(10, 7))).toEqual({
      startMin: at(9),
      endMin: at(10),
    });
  });

  it("keeps the anchor's slot when dragging upward", () => {
    expect(rangeFromDrag(at(10, 5), at(8, 50))).toEqual({
      startMin: at(8, 45),
      endMin: at(10, 15),
    });
  });

  it("never produces less than one slot", () => {
    expect(rangeFromDrag(at(9, 1), at(9, 2))).toEqual({
      startMin: at(9),
      endMin: at(9, 15),
    });
    expect(rangeFromDrag(at(9, 14), at(9, 2))).toEqual({
      startMin: at(9),
      endMin: at(9, 15),
    });
  });

  it("clamps to the day it started in", () => {
    expect(rangeFromDrag(at(22), at(24))).toEqual({
      startMin: at(22),
      endMin: at(24),
    });
    expect(rangeFromDrag(at(1), 0)).toEqual({ startMin: 0, endMin: at(1, 15) });
  });
});

describe("minutesToDate", () => {
  it("lands on local wall-clock time", () => {
    const day = new Date(2026, 8, 14);
    const d = minutesToDate(day, at(9, 30));
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([14, 9, 30]);
  });

  it("reads 24:00 as the following midnight", () => {
    const day = new Date(2026, 8, 14);
    expect(minutesToDate(day, at(24)).getTime()).toBe(
      new Date(2026, 8, 15).getTime(),
    );
  });

  it("does not leave the original date mutated", () => {
    const day = new Date(2026, 8, 14);
    minutesToDate(day, at(12));
    expect(day.getHours()).toBe(0);
  });

  describe("on a DST transition day", () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      // Europe/Berlin springs forward at 02:00 on 2026-03-29: a 23-hour day.
      process.env.TZ = "Europe/Berlin";
    });
    afterAll(() => {
      process.env.TZ = originalTz;
    });

    it("keeps wall-clock times after the gap", () => {
      const day = new Date(2026, 2, 29);
      const d = minutesToDate(day, at(10));
      expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([29, 10, 0]);
      expect(minutesToDate(day, at(24)).getTime()).toBe(
        new Date(2026, 2, 30).getTime(),
      );
    });
  });
});

describe("formatClock / parseClock", () => {
  it("round-trips a time input's value", () => {
    expect(formatClock(at(7, 5))).toBe("07:05");
    expect(formatClock(at(24))).toBe("24:00");
    expect(parseClock("07:05")).toBe(at(7, 5));
  });

  it("rejects an empty or malformed value", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("7:5")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
  });
});
