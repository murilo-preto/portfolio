"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Category = {
  id: number;
  name: string;
};

type CategoryPickerProps = {
  /** Pre-sorted by priority — most-used recently first. */
  categories: Category[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  loading?: boolean;
  error?: string | null;
  /** Locked while a session is in flight — its time is already attributed. */
  locked?: boolean;
};

// Matches the flex `gap-2` between chips.
const GAP = 8;

const CHIP_BASE =
  "text-sm px-4 py-2.5 rounded-full border whitespace-nowrap transition-colors";
const CHIP_IDLE =
  "bg-surface-raised border-default " +
  "text-gray-700 dark:text-gray-200 hover:bg-surface-hover";
const CHIP_ON = "bg-green-500 border-green-500 text-white";
const CHIP_MORE =
  "border-dashed border-default text-muted";

export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  loading = false,
  error = null,
  locked = false,
}: CategoryPickerProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(categories.length);

  // Chips fill the row and only the leftovers collapse into "More". How many
  // fit depends on the rendered text, so the widths are measured off-screen
  // and recomputed whenever the row resizes.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure || categories.length === 0) return;

    const compute = () => {
      const chips = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-chip]")
      );
      if (chips.length === 0) return;

      const available = row.clientWidth;
      if (available === 0) return;

      const widths = chips.map((el) => el.offsetWidth);
      const totalAll =
        widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1);

      // Everything fits — no "More" needed, so don't reserve room for it.
      if (totalAll <= available) {
        setVisibleCount(chips.length);
        return;
      }

      const moreWidth =
        measure.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 0;

      let used = 0;
      let count = 0;
      for (const width of widths) {
        const next = used + (count > 0 ? GAP : 0) + width;
        if (next + GAP + moreWidth <= available) {
          used = next;
          count += 1;
        } else {
          break;
        }
      }
      setVisibleCount(Math.max(1, count));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  }, [categories]);

  // Keep the count sane if the category list shrinks between measurements.
  // Adjusting during render avoids a cascading extra render from an effect.
  const [prevCategoryCount, setPrevCategoryCount] = useState(categories.length);
  if (prevCategoryCount !== categories.length) {
    setPrevCategoryCount(categories.length);
    setVisibleCount((c) => Math.min(c, Math.max(categories.length, 1)));
  }

  if (loading) {
    return <p className="text-sm text-muted py-2">Loading categories...</p>;
  }

  if (error) {
    return (
      <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
        {error}
      </p>
    );
  }

  let visible = categories.slice(0, visibleCount);
  let overflow = categories.slice(visibleCount);

  // A selection hiding inside "More" would leave the row with nothing marked
  // active, so trade it with the last visible chip.
  if (selectedId != null && overflow.some((c) => c.id === selectedId)) {
    const selected = overflow.find((c) => c.id === selectedId)!;
    const displaced = visible[visible.length - 1];
    visible = [...visible.slice(0, -1), selected];
    overflow = [
      displaced,
      ...overflow.filter((c) => c.id !== selectedId),
    ].filter(Boolean);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label className="text-sm font-medium text-secondary">
          Category
        </label>
        {locked && (
          <span className="text-[11px] text-dim">
            Finish or discard the session to change
          </span>
        )}
      </div>

      <div ref={rowRef} className="relative flex flex-wrap gap-2">
        {visible.map((cat) => {
          const active = cat.id === selectedId;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(active ? null : cat.id)}
              disabled={locked}
              aria-pressed={active}
              className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_IDLE}
                          disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {cat.name}
            </button>
          );
        })}

        {overflow.length > 0 && (
          <span
            className={`${CHIP_BASE} ${CHIP_MORE} relative inline-flex items-center gap-1
                        focus-within:ring-2 focus-within:ring-green-500
                        ${locked ? "opacity-50" : "hover:bg-surface-inset"}`}
          >
            More
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {/* A real select keeps the native picker on phones. */}
            <select
              value=""
              disabled={locked}
              aria-label="More categories"
              onChange={(e) =>
                e.target.value && onSelect(Number(e.target.value))
              }
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer
                         disabled:cursor-not-allowed"
            >
              <option value="">More…</option>
              {overflow.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </span>
        )}

        {/* Off-screen copy used only to measure natural chip widths. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="absolute -left-[9999px] top-0 flex gap-2 pointer-events-none invisible"
        >
          {categories.map((cat) => (
            <span key={cat.id} data-chip className={`${CHIP_BASE} ${CHIP_IDLE}`}>
              {cat.name}
            </span>
          ))}
          <span data-more className={`${CHIP_BASE} ${CHIP_MORE} inline-flex items-center gap-1`}>
            More
            <span className="w-3 h-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
