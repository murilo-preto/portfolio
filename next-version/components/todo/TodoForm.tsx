"use client";

import { useState } from "react";
import type { TodoItem, Category } from "./types";
import { CategorySelector } from "./CategorySelector";

type TodoFormProps = {
  categories: Category[];
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    category: string;
    description: string;
    priority: "low" | "medium" | "high";
    due_date: string | null;
  }) => Promise<void>;
  editingItem?: TodoItem | null;
};

export function TodoForm({
  categories,
  onClose,
  onSubmit,
  editingItem,
}: TodoFormProps) {
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [category, setCategory] = useState(editingItem?.category ?? "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(
    editingItem?.priority ?? "medium"
  );
  const [dueDate, setDueDate] = useState(
    editingItem?.due_date
      ? new Date(editingItem.due_date).toISOString().slice(0, 16)
      : ""
  );
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

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
      });

      setStatus("success");
      setMessage(editingItem ? "TODO item updated!" : "TODO item created!");
      setTitle("");
      setCategory("");
      setDescription("");
      setPriority("medium");
      setDueDate("");

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message || "Failed to save TODO item");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 space-y-4"
    >
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
  );
}
