import { CHART_SERIES_COUNT } from "@/lib/use-chart-colors";

/**
 * Category → `--chart-N` slot (1-based). The colours themselves live in
 * `globals.css`, one set per theme and dark style; this only decides which
 * slot each category wears.
 *
 * Colour follows the category, never its position in what happens to be
 * visible. Every chart and the calendar on a page share one map, built from
 * a list that does not change with the week or the filter, so a category is
 * the same colour in the bar chart, the pie and the calendar, this week and
 * next. Past eight categories the slots repeat; there are only eight series.
 */
export type ColorSlots = ReadonlyMap<string, number>;

export function colorSlotsFor(categories: readonly string[]): ColorSlots {
  const slots = new Map<string, number>();
  for (const name of categories) {
    if (!slots.has(name)) {
      slots.set(name, (slots.size % CHART_SERIES_COUNT) + 1);
    }
  }
  return slots;
}

/**
 * The page's order: categories by id, so creation order — a new category
 * takes the next slot and never repaints the ones before it. Any name the
 * entries carry that the list lacks (the category request failed, or it is
 * still loading) follows, by name.
 */
export function categoryOrder(
  categories: readonly { id: number; name: string }[],
  entryCategories: readonly string[],
): string[] {
  const byId = [...categories].sort((a, b) => a.id - b.id).map((c) => c.name);
  const known = new Set(byId);
  const extra = [...new Set(entryCategories)]
    .filter((name) => !known.has(name))
    .sort((a, b) => a.localeCompare(b));
  return [...byId, ...extra];
}

/**
 * For a chart rendered without a page-level map: its own entries' categories
 * by name. Charts that receive the same entries still agree, which is all
 * such a page can promise.
 */
export function fallbackSlots(entryCategories: readonly string[]): ColorSlots {
  return colorSlotsFor(categoryOrder([], entryCategories));
}
