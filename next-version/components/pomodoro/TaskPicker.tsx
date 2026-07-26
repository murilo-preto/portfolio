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
    <div className="bg-surface p-4 rounded-xl shadow-sm border border-subtle">
      <h2 className="text-sm font-semibold text-primary mb-3">
        Working on
      </h2>

      {loading ? (
        <p className="text-xs text-muted">Loading tasks...</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <select
          value={selectedTodo?.id ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onSelectTodo(todos.find((t) => t.id === id) ?? null);
          }}
          className="w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
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
