"use client";

import type { TodoItem } from "./types";

type SummaryCardsProps = {
  items: TodoItem[];
  pomodoroSessionsToday: number;
};

export function SummaryCards({ items, pomodoroSessionsToday }: SummaryCardsProps) {
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const pending = items.filter((i) => i.status === "pending").length;

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {/* Total */}
      <div className="col-span-1 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{total}</p>
          </div>
        </div>
      </div>

      {/* Pending */}
      <div className="col-span-1 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gray-500/10 border border-gray-500/20">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Pending</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{pending}</p>
          </div>
        </div>
      </div>

      {/* In Progress */}
      <div className="col-span-1 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">In Progress</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{inProgress}</p>
          </div>
        </div>
      </div>

      {/* Completed */}
      <div className="col-span-1 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{completed}</p>
          </div>
        </div>
      </div>

      {/* Pomodoros Today */}
      <div className="col-span-1 bg-white dark:bg-neutral-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Pomodoros</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{pomodoroSessionsToday}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
