"use client";

import type { TodoItem } from "./types";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, isOverdue } from "./utils";

type TodoItemProps = {
  item: TodoItem;
  onToggleComplete: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
};

export function TodoItemComponent({
  item,
  onToggleComplete,
  onEdit,
  onDelete,
}: TodoItemProps) {
  const overdue = isOverdue(item.due_date, item.status);

  return (
    <div
      className={`p-4 rounded-xl border transition-all ${
        item.status === "completed"
          ? "bg-gray-50 dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 opacity-75"
          : "bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500"
      } ${overdue ? "border-red-300 dark:border-red-700" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggleComplete(item)}
          className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
            item.status === "completed"
              ? "bg-green-500 border-green-500 text-white"
              : "border-gray-300 dark:border-neutral-600 hover:border-green-500"
          }`}
        >
          {item.status === "completed" && (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={`font-medium text-gray-900 dark:text-gray-100 ${
                item.status === "completed" ? "line-through text-gray-500" : ""
              }`}
            >
              {item.title}
            </h3>
            <PriorityBadge priority={item.priority} />
            <StatusBadge status={item.status} />
          </div>

          {item.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
              {item.description}
            </p>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
            <span className="font-medium text-gray-600 dark:text-gray-300">
              {item.category}
            </span>
            {item.due_date && (
              <span className={overdue ? "text-red-500" : ""}>
                Due: {formatDateTime(item.due_date)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(item)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={() => onDelete(item)}
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
