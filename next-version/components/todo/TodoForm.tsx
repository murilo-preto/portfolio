"use client";

import { useEffect, useRef, useState } from "react";
import type { TodoItem, Category, RecurrenceRule } from "@/lib/types";
import { CategorySelector } from "./CategorySelector";
import { TagInput } from "./TagInput";
import { endOfDayOffsetLocalValue, toLocalDatetimeValue } from "./utils";

const LAST_CATEGORY_KEY = "todoLastCategory";
const LAST_PRIORITY_KEY = "todoLastPriority";

type Priority = "low" | "medium" | "high";

// Defaults for a *new* item: last-used category (only if it still exists) and
// priority, falling back to blank / "medium". Guarded so storage being
// unavailable never breaks the form.
function readLastCreateDefaults(categories: Category[]): {
  category: string;
  priority: Priority;
} {
  let category = "";
  let priority: Priority = "medium";
  try {
    const lastCategory = localStorage.getItem(LAST_CATEGORY_KEY);
    if (lastCategory && categories.some((c) => c.name === lastCategory)) {
      category = lastCategory;
    }
    const lastPriority = localStorage.getItem(LAST_PRIORITY_KEY);
    if (lastPriority === "low" || lastPriority === "medium" || lastPriority === "high") {
      priority = lastPriority;
    }
  } catch {
    // ignore unavailable/malformed storage
  }
  return { category, priority };
}

type TodoFormProps = {
  isOpen: boolean;
  categories: Category[];
  onCategoryCreated: (category: Category) => void;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    category: string;
    description: string;
    priority: "low" | "medium" | "high";
    due_date: string | null;
    recurrence_rule: RecurrenceRule;
    tags: string[];
  }) => Promise<void>;
  editingItem?: TodoItem | null;
};

export function TodoForm({
  isOpen,
  categories,
  onCategoryCreated,
  onClose,
  onSubmit,
  editingItem,
}: TodoFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The resync effect below reads the current categories when the form opens,
  // but must NOT depend on `categories`: creating a category inside the form
  // mutates that prop, and re-running the reset would wipe in-progress input.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [category, setCategory] = useState(
    () => editingItem?.category ?? readLastCreateDefaults(categories).category
  );
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [priority, setPriority] = useState<Priority>(
    () => editingItem?.priority ?? readLastCreateDefaults(categories).priority
  );
  const [dueDate, setDueDate] = useState(toLocalDatetimeValue(editingItem?.due_date ?? null));
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>(
    editingItem?.recurrence_rule ?? "none"
  );
  const [tags, setTags] = useState<string[]>(
    editingItem?.tags?.map((t) => t.name) ?? []
  );
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // TodoForm stays mounted for the lifetime of the page (only `isOpen` toggles
  // the dialog), so field state must be resynced from `editingItem` every time
  // the form opens rather than just on first mount.
  useEffect(() => {
    if (!isOpen) return;
    const defaults = editingItem ? null : readLastCreateDefaults(categoriesRef.current);
    setTitle(editingItem?.title ?? "");
    setCategory(editingItem?.category ?? defaults?.category ?? "");
    setDescription(editingItem?.description ?? "");
    setPriority(editingItem?.priority ?? defaults?.priority ?? "medium");
    setDueDate(toLocalDatetimeValue(editingItem?.due_date ?? null));
    setRecurrenceRule(editingItem?.recurrence_rule ?? "none");
    setTags(editingItem?.tags?.map((t) => t.name) ?? []);
    setStatus("idle");
    setMessage(null);
  }, [isOpen, editingItem]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim() || !category) return;

    setStatus("loading");
    setMessage(null);

    try {
      await onSubmit({
        title: title.trim(),
        category,
        description: description.trim(),
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        recurrence_rule: dueDate ? recurrenceRule : "none",
        tags,
      });

      // Remember the choices so the next new item defaults to them.
      if (!editingItem) {
        try {
          localStorage.setItem(LAST_CATEGORY_KEY, category);
          localStorage.setItem(LAST_PRIORITY_KEY, priority);
        } catch {
          // ignore unavailable storage
        }
      }

      setStatus("success");
      setMessage(editingItem ? "To Do item updated!" : "To Do item created!");

      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to save To Do item");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto max-h-[90vh] overflow-y-auto rounded-xl shadow-lg border border-subtle bg-surface p-0 backdrop:bg-black/50 max-w-lg w-full"
    >
      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.currentTarget.requestSubmit();
          }
        }}
        className="p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-primary">
            {editingItem ? "Edit To Do" : "Create To Do"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted uppercase tracking-wide">
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
            required
          />
        </div>

        {/* Category + Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          {/* Category */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted uppercase tracking-wide">
              Category *
            </label>
            <CategorySelector
              value={category}
              onChange={setCategory}
              categories={categories}
              onCategoryCreated={onCategoryCreated}
              placeholder="Select a category"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted uppercase tracking-wide">
              Priority
            </label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition active:scale-[0.97] ${
                    priority === p
                      ? p === "high"
                        ? "bg-red-500 text-white"
                        : p === "medium"
                        ? "bg-amber-500 text-white"
                        : "bg-blue-500 text-white"
                      : "bg-surface-muted text-muted hover:bg-gray-200 dark:hover:bg-neutral-700"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted uppercase tracking-wide">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 resize-none"
          />
        </div>

        {/* Due Date + Repeat */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          {/* Due Date */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted uppercase tracking-wide">
              Due Date
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Today", value: () => endOfDayOffsetLocalValue(0) },
                { label: "Tomorrow", value: () => endOfDayOffsetLocalValue(1) },
                { label: "Next week", value: () => endOfDayOffsetLocalValue(7) },
                { label: "No date", value: () => "" },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setDueDate(preset.value())}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-muted text-muted hover:bg-surface-hover transition active:scale-95"
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
            />
          </div>

          {/* Recurrence */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted uppercase tracking-wide">
              Repeat
            </label>
            <select
              value={recurrenceRule}
              onChange={(e) => setRecurrenceRule(e.target.value as RecurrenceRule)}
              disabled={!dueDate}
              className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:opacity-50"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {!dueDate && (
              <p className="text-xs text-dim">
                Set a due date to enable repeating
              </p>
            )}
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted uppercase tracking-wide">
            Tags
          </label>
          <TagInput value={tags} onChange={setTags} />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={status === "loading" || !title.trim() || !category}
          className="w-full py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm disabled:opacity-40 hover:opacity-90 transition active:scale-[0.99] disabled:active:scale-100"
        >
          {status === "loading"
            ? "Saving..."
            : editingItem
            ? "Update To Do"
            : "Create To Do"}
        </button>

        {/* Message */}
        {message && (
          <div
            className={`p-3 rounded-lg text-sm ${
              status === "success"
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            }`}
          >
            {message}
          </div>
        )}
      </form>
    </dialog>
  );
}
