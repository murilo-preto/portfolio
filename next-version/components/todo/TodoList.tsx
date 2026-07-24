"use client";

import type { TodoItem, StatusFilter, PriorityFilter, Tag } from "@/lib/types";
import { TodoItemComponent } from "./TodoItem";

export type SortOption = "priority" | "due_date" | "created" | "alphabetical";

type TodoListProps = {
  items: TodoItem[];
  loading: boolean;
  error: string | null;
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  categoryFilter: string;
  tagFilter: string[];
  searchQuery: string;
  sortOption: SortOption;
  onStatusFilterChange: (status: StatusFilter) => void;
  onPriorityFilterChange: (priority: PriorityFilter) => void;
  onCategoryFilterChange: (category: string) => void;
  onTagFilterChange: (tags: string[]) => void;
  onSearchQueryChange: (query: string) => void;
  onSortOptionChange: (sort: SortOption) => void;
  onToggleComplete: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  categories: string[];
  allTags: Tag[];
  selectMode: boolean;
  onToggleSelectMode: () => void;
  selectedIds: Set<number>;
  onToggleSelectItem: (item: TodoItem) => void;
  onBulkStatusChange: (status: "pending" | "in_progress" | "completed") => void;
  onBulkDelete: () => void;
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function TodoList({
  items,
  loading,
  error,
  statusFilter,
  priorityFilter,
  categoryFilter,
  tagFilter,
  searchQuery,
  sortOption,
  onStatusFilterChange,
  onPriorityFilterChange,
  onCategoryFilterChange,
  onTagFilterChange,
  onSearchQueryChange,
  onSortOptionChange,
  onToggleComplete,
  onEdit,
  onDelete,
  categories,
  allTags,
  selectMode,
  onToggleSelectMode,
  selectedIds,
  onToggleSelectItem,
  onBulkStatusChange,
  onBulkDelete,
}: TodoListProps) {
  const query = searchQuery.trim().toLowerCase();

  const filteredItems = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (
      tagFilter.length > 0 &&
      !tagFilter.every((t) => item.tags.some((tag) => tag.name === t))
    )
      return false;
    if (
      query &&
      !item.title.toLowerCase().includes(query) &&
      !(item.description ?? "").toLowerCase().includes(query)
    )
      return false;
    return true;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    // Completed items always sink to the bottom regardless of sort choice
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;

    switch (sortOption) {
      case "priority":
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      case "due_date": {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      case "created":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "alphabetical":
        return a.title.localeCompare(b.title);
    }
  });

  return (
    <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          To Do Items
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {filteredItems.length} of {items.length} items
          </span>
          <button
            onClick={onToggleSelectMode}
            className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-neutral-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-neutral-800"
          >
            {selectMode ? "Done" : "Select"}
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
          <span className="text-xs text-blue-700 dark:text-blue-300 mr-1">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => onBulkStatusChange("pending")}
            className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600"
          >
            Mark Pending
          </button>
          <button
            onClick={() => onBulkStatusChange("in_progress")}
            className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600"
          >
            Mark In Progress
          </button>
          <button
            onClick={() => onBulkStatusChange("completed")}
            className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-gray-300 dark:border-neutral-600"
          >
            Mark Completed
          </button>
          <button
            onClick={onBulkDelete}
            className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white"
          >
            Delete
          </button>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchQueryChange(e.target.value)}
        placeholder="Search title or description..."
        className="w-full px-3 py-2 mb-3 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
      />

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
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

        <select
          value={sortOption}
          onChange={(e) => onSortOptionChange(e.target.value as SortOption)}
          className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-400"
        >
          <option value="priority">Sort: Priority</option>
          <option value="due_date">Sort: Due Date</option>
          <option value="created">Sort: Created</option>
          <option value="alphabetical">Sort: A-Z</option>
        </select>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {allTags.map((tag) => {
            const active = tagFilter.includes(tag.name);
            return (
              <button
                key={tag.id}
                onClick={() =>
                  onTagFilterChange(
                    active
                      ? tagFilter.filter((t) => t !== tag.name)
                      : [...tagFilter, tag.name]
                  )
                }
                className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                  active
                    ? "bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-800 dark:border-neutral-100"
                    : "bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700"
                }`}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Loading To Do items...
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500">{error}</div>
      ) : sortedItems.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          {items.length === 0
            ? "No To Do items. Create one to get started!"
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
              selectMode={selectMode}
              isSelected={selectedIds.has(item.id)}
              onToggleSelect={onToggleSelectItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
