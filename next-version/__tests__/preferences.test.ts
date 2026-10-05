/**
 * The dark style comes from a settings blob Flask does not validate, and from
 * localStorage, so it is narrowed on the way in. An unknown value must fall
 * back to the default rather than name a style no CSS block matches.
 */
import { describe, expect, it } from "vitest";
import { parseDarkStyle } from "@/lib/preferences";

describe("parseDarkStyle", () => {
  it("keeps the known styles", () => {
    expect(parseDarkStyle("default")).toBe("default");
    expect(parseDarkStyle("oled")).toBe("oled");
    expect(parseDarkStyle("glass")).toBe("glass");
  });

  it("maps anything else to the default", () => {
    for (const raw of ["OLED", "Glass", "midnight", "", null, undefined, 1, {}]) {
      expect(parseDarkStyle(raw)).toBe("default");
    }
  });
});
