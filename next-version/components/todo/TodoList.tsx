"use client";

import type { TodoItem, StatusFilter, PriorityFilter } from "./types";
import { TodoItemComponent } from "./TodoItem";

type TodoListProps = {
  items: TodoItem[];
  loading: boolean;
  error: string | null;
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  categoryFilter: string;
  onStatusFilterChange: (status: StatusFilter) => void;
  onPriorityFilterChange: (priority: PriorityFilter) => void;
  onCategoryFilterChange: (category: string) => void;
  onToggleComplete: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  categories: string[];
};

export function TodoList({
  items,
  loading,
  error,
  statusFilter,
  priorityFilter,
  categoryFilter,
  onStatusFilterChange,
  onPriorityFilterChange,
  onCategoryFilterChange,
  onToggleComplete,
  onEdit,
  onDelete,
  categories,
}: TodoListProps) {
  // Filter items
  const filteredItems = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    return true;
  });

  // Sort: pending/in_progress first, then by priority
  const sortedItems = [...filteredItems].sort((a, b) => {
    // Completed items go to the bottom
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;

    // Then by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return (
    <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          TODO Items
        </h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {filteredItems.length} of {items.length} items
        </span>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => onPriorityFilterChange(e.target.value as PriorityFilter)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          <option value="all">All Priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Loading TODO items...
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500">{error}</div>
      ) : sortedItems.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {items.length === 0
            ? "No TODO items. Create one to get started!"
            : "No items match the current filters."}
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {sortedItems.map((item) => (
            <TodoItemComponent
              key={item.id}
              item={item}
              onToggleComplete={onToggleComplete}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
