"use client";

import type { TodoItem } from "@/lib/types";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, isOverdue } from "./utils";

type TodoItemProps = {
  item: TodoItem;
  onToggleComplete: (item: TodoItem) => void;
  onEdit: (item: TodoItem) => void;
  onDelete: (item: TodoItem) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (item: TodoItem) => void;
};

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  monthly: "Repeats monthly",
};

export function TodoItemComponent({
  item,
  onToggleComplete,
  onEdit,
  onDelete,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: TodoItemProps) {
  const overdue = isOverdue(item.due_date, item.status);

  return (
    <div
      className={`p-4 rounded-xl border transition-all duration-200 animate-rise ${
        item.status === "completed"
          ? "bg-gray-50 dark:bg-neutral-900 border-subtle opacity-75 hover:shadow-sm"
          : "bg-surface border-default hover:border-neutral-400 dark:hover:border-neutral-500 hover:shadow-sm"
      } ${overdue ? "border-red-300 dark:border-red-700" : ""}`}
    >
      <div className="flex items-start gap-3">
        {selectMode ? (
          <button
            onClick={() => onToggleSelect?.(item)}
            className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
              isSelected
                ? "bg-blue-500 border-blue-500 text-white"
                : "border-strong hover:border-blue-500"
            }`}
            aria-label="Select item"
          >
            {isSelected && (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>
        ) : (
          <button
            onClick={() => onToggleComplete(item)}
            className={`mt-1 w-5 h-5 rounded border flex items-center justify-center transition active:scale-90 ${
              item.status === "completed"
                ? "bg-green-500 border-green-500 text-white"
                : "border-strong hover:border-green-500"
            }`}
            aria-label="Toggle complete"
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
        )}

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
            {item.recurrence_rule !== "none" && (
              <span
                title={RECURRENCE_LABELS[item.recurrence_rule]}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-50 dark:bg-purple-900/20 text-tint-purple-ink dark:text-purple-400 border border-purple-200 dark:border-purple-800"
              >
                ↻ {RECURRENCE_LABELS[item.recurrence_rule]}
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-sm text-muted mt-1 line-clamp-2">
              {item.description}
            </p>
          )}

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs bg-surface-muted text-neutral-600 dark:text-neutral-400 border border-default"
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-dim">
            <span className="font-medium text-secondary">
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
        {!selectMode && (
          <div className="flex items-center gap-1">
            <a
              href={`/namu/user/pomodoro?todo_id=${item.id}`}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted hover:text-red-500 transition-colors active:scale-90"
              title="Start Pomodoro"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </a>
            <button
              onClick={() => onEdit(item)}
              className="p-1.5 rounded-lg hover:bg-surface-inset text-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors active:scale-90"
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
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted hover:text-red-500 transition-colors active:scale-90"
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
        )}
      </div>
    </div>
  );
}
