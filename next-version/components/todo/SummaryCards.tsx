"use client";

import type { TodoItem } from "@/lib/types";

type SummaryCardsProps = {
  items: TodoItem[];
};

export function SummaryCards({ items }: SummaryCardsProps) {
  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total */}
      <div className="col-span-1 bg-surface p-4 rounded-xl shadow-sm border border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tint-blue-a border border-tint-blue-line">
            <svg className="w-5 h-5 text-tint-blue-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-muted">Total</p>
            <p className="text-xl font-bold text-primary">{total}</p>
          </div>
        </div>
      </div>

      {/* Pending */}
      <div className="col-span-1 bg-surface p-4 rounded-xl shadow-sm border border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tint-gray-a border border-tint-gray-line">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-muted">Pending</p>
            <p className="text-xl font-bold text-primary">{pending}</p>
          </div>
        </div>
      </div>

      {/* In Progress */}
      <div className="col-span-1 bg-surface p-4 rounded-xl shadow-sm border border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tint-amber-a border border-tint-amber-line">
            <svg className="w-5 h-5 text-tint-amber-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-muted">In Progress</p>
            <p className="text-xl font-bold text-primary">{inProgress}</p>
          </div>
        </div>
      </div>

      {/* Completed */}
      <div className="col-span-1 bg-surface p-4 rounded-xl shadow-sm border border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-tint-green-a border border-tint-green-line">
            <svg className="w-5 h-5 text-tint-green-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-muted">Completed</p>
            <p className="text-xl font-bold text-primary">{completed}</p>
          </div>
        </div>
      </div>

    </div>
  );
}
