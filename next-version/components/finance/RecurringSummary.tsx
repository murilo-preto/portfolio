"use client";

import { formatPrice } from "@/components/finance/utils";
import type { RecurringExpense } from "@/components/finance/types";

type RecurringSummaryProps = {
  recurringExpenses: RecurringExpense[];
};

const frequencyMultipliers: Record<string, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  quarterly: 0.33,
  yearly: 0.083,
};

export function RecurringSummary({ recurringExpenses }: RecurringSummaryProps) {
  const activeExpenses = recurringExpenses.filter((r) => r.is_active);
  const monthlyTotal = activeExpenses.reduce(
    (sum, r) => sum + r.amount * (frequencyMultipliers[r.frequency] || 1),
    0
  );

  const topExpenses = [...activeExpenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  if (activeExpenses.length === 0) {
    return (
      <div className="bg-surface p-4 md:p-5 rounded-xl shadow-sm border border-subtle">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-primary">
            Recurring Expenses
          </h2>
          <span className="text-xs text-muted">No active subscriptions</span>
        </div>
        <p className="text-xs text-muted text-center py-4">
          No recurring expenses configured
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface p-4 md:p-5 rounded-xl shadow-sm border border-subtle">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-primary">
          Recurring Expenses
        </h2>
        <a
          href="/namu/user/finance/recurring"
          className="text-xs text-tint-blue-ink dark:text-blue-400 hover:underline font-medium"
        >
          Manage →
        </a>
      </div>

      {/* Monthly Total */}
      <div className="mb-4 p-3 rounded-lg bg-gradient-to-br from-tint-blue-a to-tint-blue-b border border-tint-blue-line">
        <p className="text-xs text-muted">Monthly Total</p>
        <p className="text-xl font-bold text-primary">
          {formatPrice(monthlyTotal)}
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="p-2 rounded-lg bg-surface-inset">
          <p className="text-xs text-muted">Active</p>
          <p className="text-lg font-semibold text-primary">
            {activeExpenses.length}
          </p>
        </div>
        <div className="p-2 rounded-lg bg-surface-inset">
          <p className="text-xs text-muted">Yearly</p>
          <p className="text-lg font-semibold text-primary">
            {formatPrice(monthlyTotal * 12)}
          </p>
        </div>
      </div>

      {/* Top Expenses */}
      {topExpenses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">
            Top Expenses
          </p>
          {topExpenses.map((expense) => (
            <div
              key={expense.id}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-surface-inset transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-primary truncate">
                  {expense.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted">
                    {expense.category}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-hover text-muted capitalize">
                    {expense.frequency}
                  </span>
                </div>
              </div>
              <p className="font-semibold text-primary text-sm">
                {formatPrice(expense.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
