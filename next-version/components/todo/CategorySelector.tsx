"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";

const NEW_CATEGORY_VALUE = "__new__";

type CategorySelectorProps = {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  onCategoryCreated?: (category: Category) => void;
  placeholder?: string;
};

export function CategorySelector({
  value,
  onChange,
  categories,
  onCategoryCreated,
  placeholder = "Select category",
}: CategorySelectorProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSelectChange(selected: string) {
    if (selected === NEW_CATEGORY_VALUE) {
      setCreating(true);
      setNewName("");
      setError(null);
      return;
    }
    onChange(selected);
  }

  async function handleCreateCategory() {
    const name = newName.trim();
    if (!name) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/todo/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create category");

      onCategoryCreated?.(data.category);
      onChange(data.category.name);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create category");
    } finally {
      setSubmitting(false);
    }
  }

  if (creating) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateCategory();
              } else if (e.key === "Escape") {
                setCreating(false);
              }
            }}
            placeholder="New category name"
            className="flex-1 min-w-[8rem] px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
          />
          <button
            type="button"
            onClick={handleCreateCategory}
            disabled={submitting || !newName.trim()}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-invert text-invert-fg disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-surface-muted text-secondary"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => handleSelectChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
    >
      <option value="">{placeholder}</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.name}>
          {cat.name}
        </option>
      ))}
      <option value={NEW_CATEGORY_VALUE}>+ New category...</option>
    </select>
  );
}
