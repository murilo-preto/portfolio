/**
 * Wording for the Namu app's stay, phones and events. Pure functions taking
 * `now`, so no DOM and no fake timers.
 */
import { describe, expect, it } from "vitest";
import {
  agoLabel,
  elapsedLabel,
  lateLabel,
  spanLabel,
} from "@/components/presence/presenceText";

const NOW = new Date("2026-10-17T15:00:00Z");
const minutesBefore = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("spanLabel", () => {
  it("rounds down to the minute", () => {
    expect(spanLabel(59_999)).toBe("under a minute");
    expect(spanLabel(60_000)).toBe("1 min");
    expect(spanLabel(45 * 60_000 + 59_000)).toBe("45 min");
  });

  it("shows hours, and minutes only when there are some", () => {
    expect(spanLabel(2 * 3_600_000)).toBe("2 h");
    expect(spanLabel(2 * 3_600_000 + 14 * 60_000)).toBe("2 h 14 min");
  });

  it("treats a negative or unreadable span as under a minute", () => {
    expect(spanLabel(-5_000)).toBe("under a minute");
    expect(spanLabel(NaN)).toBe("under a minute");
  });
});

describe("elapsedLabel", () => {
  it("measures from the stay's start to now", () => {
    expect(elapsedLabel(minutesBefore(134), NOW)).toBe("2 h 14 min");
  });
});

describe("agoLabel", () => {
  it.each([
    [null, "never"],
    ["not a date", "never"],
    [minutesBefore(0.5), "just now"],
    [minutesBefore(5), "5 min ago"],
    [minutesBefore(180), "3 h ago"],
    [minutesBefore(26 * 60), "1 day ago"],
    [minutesBefore(3 * 24 * 60), "3 days ago"],
  ])("%s is %s", (iso, expected) => {
    expect(agoLabel(iso, NOW)).toBe(expected);
  });
});

describe("lateLabel", () => {
  it("is null for an event that arrived promptly", () => {
    expect(lateLabel(minutesBefore(1), NOW.toISOString())).toBeNull();
  });

  it("says how long a queued event was held", () => {
    expect(lateLabel(minutesBefore(63), NOW.toISOString())).toBe("1 h 3 min late");
  });
});
