"use client";

import { useEffect, useRef, useState } from "react";
import type { TodoItem, Category, RecurrenceRule } from "@/lib/types";
import { CategorySelector } from "./CategorySelector";
import { TagInput } from "./TagInput";
import { toLocalDatetimeValue } from "./utils";

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

  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [category, setCategory] = useState(editingItem?.category ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(
    editingItem?.priority ?? "medium"
  );
  // Pre-filling with "now" makes a from-scratch datetime-local field faster
  // to adjust, but a new item should still have no due date if the user
  // never touches the field — so we track the auto-filled value and treat
  // it as "unset" at submit time unless it's changed.
  const autoFilledDueDateRef = useRef(
    editingItem?.due_date ? null : toLocalDatetimeValue(new Date().toISOString())
  );
  const [dueDate, setDueDate] = useState(
    toLocalDatetimeValue(editingItem?.due_date ?? null) || autoFilledDueDateRef.current || ""
  );
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

  const dueDateUntouched = Boolean(dueDate) && dueDate === autoFilledDueDateRef.current;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

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
        due_date: dueDate && !dueDateUntouched ? new Date(dueDate).toISOString() : null,
        recurrence_rule: dueDateUntouched ? "none" : recurrenceRule,
        tags,
      });

      setStatus("success");
      setMessage(editingItem ? "TODO item updated!" : "TODO item created!");

      setTimeout(() => {
        onClose();
      }, 600);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to save TODO item");
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
      className="m-auto max-h-[90vh] overflow-y-auto rounded-xl shadow-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-0 backdrop:bg-black/50 max-w-md w-full"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base text-gray-900 dark:text-gray-100">
            {editingItem ? "Edit TODO" : "Create TODO"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
            required
          />
        </div>

        {/* Category */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
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

        {/* Description */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 resize-none"
          />
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Priority
          </label>
          <div className="flex gap-2">
            {(["low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  priority === p
                    ? p === "high"
                      ? "bg-red-500 text-white"
                      : p === "medium"
                      ? "bg-amber-500 text-white"
                      : "bg-blue-500 text-white"
                    : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Due Date */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Due Date
          </label>
          <input
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
          />
        </div>

        {/* Recurrence */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Repeat
          </label>
          <select
            value={recurrenceRule}
            onChange={(e) => setRecurrenceRule(e.target.value as RecurrenceRule)}
            disabled={!dueDate || dueDateUntouched}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:opacity-50"
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          {(!dueDate || dueDateUntouched) && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Set a due date to enable repeating
            </p>
          )}
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Tags
          </label>
          <TagInput value={tags} onChange={setTags} />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={status === "loading" || !title.trim() || !category}
          className="w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {status === "loading"
            ? "Saving..."
            : editingItem
            ? "Update TODO"
            : "Create TODO"}
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
