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
      <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Recurring Expenses
          </h2>
          <span className="text-xs text-gray-400">No active subscriptions</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
          No recurring expenses configured
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Recurring Expenses
        </h2>
        <a
          href="/namu/user/finance/recurring"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          Manage →
        </a>
      </div>

      {/* Monthly Total */}
      <div className="mb-4 p-3 rounded-lg bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
        <p className="text-xs text-gray-500 dark:text-gray-400">Monthly Total</p>
        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
          {formatPrice(monthlyTotal)}
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Active</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {activeExpenses.length}
          </p>
        </div>
        <div className="p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Yearly</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatPrice(monthlyTotal * 12)}
          </p>
        </div>
      </div>

      {/* Top Expenses */}
      {topExpenses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Top Expenses
          </p>
          {topExpenses.map((expense) => (
            <div
              key={expense.id}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {expense.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {expense.category}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-gray-400 capitalize">
                    {expense.frequency}
                  </span>
                </div>
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                {formatPrice(expense.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
