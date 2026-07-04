"use client";

import type { TodoItem } from "@/lib/types";

type TaskPickerProps = {
  todos: TodoItem[];
  loading: boolean;
  error: string | null;
  selectedTodo: TodoItem | null;
  onSelectTodo: (todo: TodoItem | null) => void;
};

export function TaskPicker({
  todos,
  loading,
  error,
  selectedTodo,
  onSelectTodo,
}: TaskPickerProps) {
  return (
    <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Working on
      </h2>

      {loading ? (
        <p className="text-xs text-gray-400">Loading tasks...</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <select
          value={selectedTodo?.id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onSelectTodo(todos.find((t) => t.id === id) ?? null);
          }}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          <option value="">No task selected</option>
          {todos.map((todo) => (
            <option key={todo.id} value={todo.id}>
              {todo.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
