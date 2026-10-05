"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * The active theme's chart colours, resolved to concrete values.
 *
 * Every theme and dark style defines its series in `globals.css` (`--chart-1`
 * … `--chart-8`, `--chart-on`). Recharts writes colours into SVG presentation
 * attributes (`fill`, `stroke`), where `var()` is not reliably honoured, so
 * the tokens are read from the computed style instead. Inline `style` objects
 * — tooltips, legend text — can and should keep using `var()` directly.
 *
 * The values change with the OS scheme and with the two attributes the
 * settings page and the pre-paint script set on <html>, so all three are
 * watched; a MutationObserver because those attributes are set outside React.
 */

export const CHART_SERIES_COUNT = 8;

const SERIES_TOKENS = Array.from(
  { length: CHART_SERIES_COUNT },
  (_, i) => `--chart-${i + 1}`,
);

const TOKENS = [
  ...SERIES_TOKENS,
  "--chart-on",
  "--border-subtle",
  "--text-muted",
  "--surface-hover",
  "--surface",
];

export type ChartColors = {
  /** One colour per series, in assignment order. */
  series: string[];
  /** Text set on a solid series fill, e.g. a pie slice's percentage. */
  on: string;
  grid: string;
  axis: string;
  /** The highlight behind a hovered bar. */
  cursor: string;
  /** The hairline between pie slices: the card they sit on. */
  separator: string;
};

// Before hydration there is no computed style to read, so the server
// snapshot names the tokens themselves. Charts render nothing until
// ResponsiveContainer has measured, so this is a fallback, not what paints.
const SERVER_SNAPSHOT = TOKENS.map((token) => `var(${token})`).join("|");

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-dark-style"],
  });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", callback);
  };
}

// A joined string rather than an object, so an unchanged theme yields an
// identical snapshot and useSyncExternalStore does not re-render.
function getSnapshot() {
  const style = getComputedStyle(document.documentElement);
  return TOKENS.map((token) => style.getPropertyValue(token).trim()).join("|");
}

export function useChartColors(): ChartColors {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );

  return useMemo(() => {
    const values = snapshot.split("|");
    const [on, grid, axis, cursor, separator] =
      values.slice(CHART_SERIES_COUNT);
    return {
      series: values.slice(0, CHART_SERIES_COUNT),
      on,
      grid,
      axis,
      cursor,
      separator,
    };
  }, [snapshot]);
}

/**
 * Tooltip styling shared by every chart. Plain inline styles, so the tokens
 * apply directly and follow the theme without a re-render. The wrapper is
 * `.floating`, so Glass frosts it like any other layer over content; the
 * rounding and clip keep that frost inside the tooltip's corners.
 */
export const CHART_TOOLTIP_STYLE = {
  wrapperClassName: "floating",
  wrapperStyle: { borderRadius: "0.5rem", overflow: "hidden" },
  contentStyle: {
    backgroundColor: "var(--surface-raised)",
    border: "1px solid var(--border-default)",
    borderRadius: "0.5rem",
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-primary)" },
  itemStyle: { color: "var(--text-secondary)" },
} as const;
