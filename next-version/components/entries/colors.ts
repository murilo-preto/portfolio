import { CHART_SERIES_COUNT } from "@/lib/use-chart-colors";

/**
 * Which `--chart-N` series a category's calendar events use. The colours
 * themselves live in `globals.css`, one set per theme and dark style, so this
 * only hands out a stable slot: first come, first served, kept for the
 * lifetime of the page so a category keeps its colour across weeks.
 */
let nextIndex = 0;
const slotCache = new Map<string, number>();

export function getEventColorSlot(category: string): number {
  const cached = slotCache.get(category);
  if (cached !== undefined) return cached;

  const slot = (nextIndex % CHART_SERIES_COUNT) + 1;
  slotCache.set(category, slot);
  nextIndex++;
  return slot;
}
