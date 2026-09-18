"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Category } from "@/lib/types";
import { formatDuration } from "@/components/entries/utils";
import {
  MINUTES_PER_DAY,
  formatClock,
  minutesToDate,
  parseClock,
  type SlotRange,
} from "@/components/entries/calendarSelection";

// Mirrors MAX_NOTE_LENGTH in flask-server; the column is VARCHAR(255).
const NOTE_MAX_LENGTH = 255;

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm text-primary focus:outline-none focus:ring-2 focus:ring-neutral-400";

type QuickEntryDialogProps = {
  range: SlotRange;
  categories: Category[];
  /** Preselected when it is still one of `categories`. */
  defaultCategory?: string;
  /** The times are edited in place, so the calendar's ghost follows them. */
  onRangeChange: (range: SlotRange) => void;
  onCancel: () => void;
  /** Called after Flask accepted the entry; the page reloads and closes. */
  onCreated: () => Promise<void> | void;
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xs font-medium text-muted uppercase tracking-wide">
      {children}
    </span>
  );
}

export function QuickEntryDialog({
  range,
  categories,
  defaultCategory,
  onRangeChange,
  onCancel,
  onCreated,
}: QuickEntryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const [category, setCategory] = useState(() =>
    defaultCategory && categories.some((c) => c.name === defaultCategory)
      ? defaultCategory
      : "",
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mounted only while a selection is pending, so opening is a mount effect.
  // Focus goes to the category, the one field a click cannot fill in.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    categoryRef.current?.focus();
  }, []);

  const durationMin = range.endMin - range.startMin;
  const validRange = durationMin > 0;
  const canSave = validRange && !!category && !saving;

  function setStart(value: string) {
    const min = parseClock(value);
    if (min !== null) onRangeChange({ ...range, startMin: min });
  }

  function setEnd(value: string) {
    const min = parseClock(value);
    // 00:00 as an end time means the midnight that closes the day.
    if (min !== null) onRangeChange({ ...range, endMin: min === 0 ? MINUTES_PER_DAY : min });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/entry/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category,
          start_time: minutesToDate(range.day, range.startMin).toISOString(),
          end_time: minutesToDate(range.day, range.endMin).toISOString(),
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to create entry");
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create entry");
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="quick-entry-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
      className="m-auto rounded-xl shadow-lg border border-subtle bg-surface p-0 backdrop:bg-black/50 max-w-sm w-full text-primary"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <h2 id="quick-entry-title" className="font-semibold text-base">
            New entry
          </h2>
          <p className="text-sm text-muted mt-0.5">
            {range.day.toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="space-y-1">
          <Label>Time</Label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              step={60}
              aria-label="Start time"
              value={formatClock(range.startMin)}
              onChange={(e) => setStart(e.target.value)}
              className={INPUT_CLASS}
            />
            <span className="text-muted">–</span>
            <input
              type="time"
              step={60}
              aria-label="End time"
              value={formatClock(range.endMin % MINUTES_PER_DAY)}
              onChange={(e) => setEnd(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          {validRange ? (
            <p className="text-xs text-muted">
              Duration: {formatDuration(durationMin * 60)}
            </p>
          ) : (
            <p className="text-xs text-red-500">
              End time must be after start time.
            </p>
          )}
        </div>

        <label className="block space-y-1">
          <Label>Category</Label>
          {categories.length > 0 ? (
            <select
              ref={categoryRef}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted">
              No categories yet.{" "}
              <Link
                href="/namu/user/manage"
                className="underline underline-offset-2 hover:text-primary"
              >
                Create one
              </Link>{" "}
              first.
            </p>
          )}
        </label>

        <label className="block space-y-1">
          <Label>Note (optional)</Label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            placeholder="What did you work on?"
            className={INPUT_CLASS}
          />
        </label>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-muted text-secondary hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-invert text-invert-fg hover:bg-invert-hover disabled:opacity-40 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
