"use client";

import type { Category } from "./types";

type CategorySelectorProps = {
  value: string;
  onChange: (value: string) => void;
  categories: Category[];
  placeholder?: string;
};

export function CategorySelector({
  value,
  onChange,
  categories,
  placeholder = "Select category",
}: CategorySelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
    >
      <option value="">{placeholder}</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.name}>
          {cat.name}
        </option>
      ))}
    </select>
  );
}
