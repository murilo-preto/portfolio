"use client";

import { useEffect, useState } from "react";
import type { Tag } from "@/lib/types";

type TagInputProps = {
  value: string[];
  onChange: (tags: string[]) => void;
};

export function TagInput({ value, onChange }: TagInputProps) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    async function fetchTags() {
      try {
        const res = await fetch("/api/todo/tags");
        if (!res.ok) return;
        const data = await res.json();
        setAllTags(data.tags ?? []);
      } catch (err) {
        console.error("Failed to fetch tags:", err);
      }
    }
    fetchTags();
  }, []);

  function addTag(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (value.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setInputValue("");
      return;
    }
    onChange([...value, name]);
    setInputValue("");
  }

  function removeTag(name: string) {
    onChange(value.filter((t) => t !== name));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  const suggestions = allTags
    .map((t) => t.name)
    .filter(
      (name) =>
        !value.some((v) => v.toLowerCase() === name.toLowerCase())
    );

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5 mb-1">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-100"
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        list="todo-tag-suggestions"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(inputValue)}
        placeholder="Add a tag and press Enter"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
      />
      <datalist id="todo-tag-suggestions">
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
