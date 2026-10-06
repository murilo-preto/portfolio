/**
 * Category → chart slot. A category must be one colour in every chart and the
 * calendar, and must keep it when the week or filter changes what is visible.
 */
import { describe, expect, it } from "vitest";
import { categoryOrder, colorSlotsFor, fallbackSlots } from "@/components/entries/colors";

describe("categoryOrder", () => {
  it("orders known categories by id, so a new one never shifts the rest", () => {
    const cats = [
      { id: 7, name: "Music" },
      { id: 2, name: "Work" },
      { id: 4, name: "Reading" },
    ];
    expect(categoryOrder(cats, [])).toEqual(["Work", "Reading", "Music"]);
    expect(categoryOrder([...cats, { id: 9, name: "Art" }], [])).toEqual([
      "Work",
      "Reading",
      "Music",
      "Art",
    ]);
  });

  it("appends names only the entries carry, by name", () => {
    expect(categoryOrder([{ id: 1, name: "Work" }], ["Zen", "Work", "Art", "Zen"])).toEqual([
      "Work",
      "Art",
      "Zen",
    ]);
  });
});

describe("colorSlotsFor", () => {
  it("gives each category a fixed slot, whatever subset is on screen", () => {
    const slots = colorSlotsFor(["Work", "Reading", "Music"]);
    expect(slots.get("Music")).toBe(3);
    // Only Music visible this week: still slot 3, not slot 1.
    expect(["Music"].map((c) => slots.get(c))).toEqual([3]);
  });

  it("wraps past the eighth series", () => {
    const names = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const slots = colorSlotsFor(names);
    expect(slots.get("c7")).toBe(8);
    expect(slots.get("c8")).toBe(1);
  });
});

describe("fallbackSlots", () => {
  it("agrees for charts given the same entries, in any order", () => {
    const a = fallbackSlots(["Work", "Art", "Work"]);
    const b = fallbackSlots(["Art", "Work"]);
    expect([...a]).toEqual([...b]);
  });
});
