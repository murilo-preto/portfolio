"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/finance/EntriesTable";
import { WeekNavigator } from "@/components/finance/WeekNavigator";
import { CategoryChart } from "@/components/finance/CategoryChart";
import { CategoryPieChart } from "@/components/finance/CategoryPieChart";
import { EntriesTable } from "@/components/finance/EntriesTable";
import { getMondayOf, addDays, formatPrice } from "@/components/finance/utils";
import type { ApiResponse, FinanceEntry } from "@/components/finance/types";
import type { RecurringExpense } from "@/components/finance/types";

type FilterMode = "today" | "week" | "month" | "all";

export default function FinanceDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [monthStart, setMonthStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [filterMode, setFilterMode] = useState<FilterMode>("week");
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);

  async function getEntries() {
    try {
      const res = await fetch("/api/finance", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch finance entries");
      }

      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function getRecurringExpenses() {
    try {
      const res = await fetch("/api/recurring-expenses", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch recurring expenses");
      }

      const json = await res.json();
      setRecurringExpenses(json.expenses ?? []);
    } catch (err: unknown) {
      console.error("Failed to fetch recurring expenses:", err);
    }
  }

  useEffect(() => {
    getEntries();
    getRecurringExpenses();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const weekEnd = addDays(weekStart, 6);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

  const filteredEntries = useMemo(() => {
    if (!data) return [];

    if (filterMode === "today") {
      const today = new Date();
      const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );
      const todayEnd = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        23,
        59,
        59,
      );
      return data.entries.filter((entry) => {
        const date = new Date(entry.purchase_date);
        return date >= todayStart && date <= todayEnd;
      });
    }

    if (filterMode === "month") {
      const monthEndInclusive = new Date(monthEnd.getFullYear(), monthEnd.getMonth(), monthEnd.getDate(), 23, 59, 59);
      return data.entries.filter((entry) => {
        const date = new Date(entry.purchase_date);
        return date >= monthStart && date <= monthEndInclusive;
      });
    }

    if (filterMode === "week") {
      const weekEndInclusive = addDays(weekEnd, 1);
      return data.entries.filter((entry) => {
        const date = new Date(entry.purchase_date);
        return date >= weekStart && date <= weekEndInclusive;
      });
    }

    return [];
  }, [data, weekStart, weekEnd, monthStart, monthEnd, filterMode]);

  const visibleEntries =
    filterMode === "all" ? (data?.entries ?? []) : filteredEntries;

  // Calculate planned total for "all" view:
  // - Include all non-recurring planned payments
  // - Include only monthly recurring expenses (to avoid infinite sums)
  const plannedTotal = useMemo(() => {
    if (filterMode !== "all") {
      return visibleEntries
        .filter((e) => e.status === "planned")
        .reduce((acc, e) => acc + e.price, 0);
    }

    // For "all" view: planned one-time payments + monthly recurring expenses
    const oneTimePlanned = visibleEntries
      .filter((e) => e.status === "planned")
      .reduce((acc, e) => acc + e.price, 0);

    const monthlyRecurring = recurringExpenses
      .filter((r) => r.is_active && r.frequency === "monthly")
      .reduce((acc, r) => acc + r.amount, 0);

    return oneTimePlanned + monthlyRecurring;
  }, [filterMode, visibleEntries, recurringExpenses]);

  // Calculate statistics
  const totalSpent = visibleEntries.reduce((acc, e) => acc + e.price, 0);
  const completedTotal = visibleEntries
    .filter((e) => e.status === "done")
    .reduce((acc, e) => acc + e.price, 0);
  const entryCount = visibleEntries.length;
  const avgTransaction = entryCount > 0 ? totalSpent / entryCount : 0;

  // Find highest single transaction
  const highestTransaction = visibleEntries.reduce(
    (max, e) => (e.price > max.price ? e : max),
    { price: 0, product_name: "N/A" } as { price: number; product_name: string }
  );

  if (loading) return <main className="p-4">Loading finance dashboard...</main>;
  if (error) return <main className="p-4 text-red-500">{error}</main>;
  if (!data) return null;

  return (
    <main className="flex-1 p-4 md:p-6 space-y-8 md:space-y-12 max-w-4/5 mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {data.username}'s Finance Dashboard
          </h1>
          <p className="text-sm text-gray-500">Spending Overview</p>
        </div>
        <div className="flex flex-col gap-2">
          <a
            href="/namu/user/finance/manage"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors text-center"
          >
            Manage Finance
          </a>
          <a
            href="/namu/user/finance/recurring"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors text-center"
          >
            Recurring Expenses
          </a>
        </div>
      </div>

      <WeekNavigator
        weekStart={weekStart}
        weekEnd={weekEnd}
        monthStart={monthStart}
        monthEnd={monthEnd}
        filterMode={filterMode}
        onPrev={() => {
          if (filterMode === "month") {
            setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1));
          } else {
            setWeekStart(addDays(weekStart, -7));
          }
        }}
        onNext={() => {
          if (filterMode === "month") {
            setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1));
          } else {
            setWeekStart(addDays(weekStart, 7));
          }
        }}
        onFilterModeChange={setFilterMode}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          title="Total Spent"
          value={formatPrice(totalSpent)}
          subtitle={`${entryCount} transactions`}
        />
        <Card
          title="Planned"
          value={formatPrice(plannedTotal)}
          subtitle="Pending payments"
        />
        <Card
          title="Completed"
          value={formatPrice(completedTotal)}
          subtitle="Paid expenses"
        />
        <Card
          title="Avg. Transaction"
          value={formatPrice(avgTransaction)}
          subtitle="Per entry"
        />
      </div>

      {/* Recurring Expenses Section */}
      {recurringExpenses.length > 0 && (
        <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recurring Expenses</h2>
            <a
              href="/namu/user/finance/recurring"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Manage →
            </a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Card
              title="Monthly Total"
              value={formatPrice(
                recurringExpenses
                  .filter((r) => r.is_active)
                  .reduce((sum, r) => {
                    const multipliers: Record<string, number> = {
                      weekly: 4.33,
                      biweekly: 2.17,
                      monthly: 1,
                      quarterly: 0.33,
                      yearly: 0.083,
                    };
                    return sum + r.amount * (multipliers[r.frequency] || 1);
                  }, 0)
              )}
              subtitle="Estimated"
            />
            <Card
              title="Active"
              value={recurringExpenses.filter((r) => r.is_active).length.toString()}
              subtitle="Subscriptions"
            />
            <Card
              title="Weekly"
              value={formatPrice(
                recurringExpenses
                  .filter((r) => r.is_active && r.frequency === "weekly")
                  .reduce((sum, r) => sum + r.amount, 0)
              )}
              subtitle="Per week"
            />
            <Card
              title="Yearly"
              value={formatPrice(
                recurringExpenses
                  .filter((r) => r.is_active && r.frequency === "yearly")
                  .reduce((sum, r) => sum + r.amount, 0)
              )}
              subtitle="Per year"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recurringExpenses
              .filter((r) => r.is_active)
              .sort((a, b) => b.amount - a.amount)
              .map((expense) => (
                <div
                  key={expense.id}
                  className="p-3 rounded-lg bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {expense.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {expense.category}
                      </p>
                    </div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatPrice(expense.amount)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-gray-400 capitalize">
                      {expense.frequency}
                    </span>
                    {expense.next_payment_date && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Next: {new Date(expense.next_payment_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Charts Section */}
      {filterMode === "all" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Spending by Category</h2>
              <span className="text-xs opacity-70">Scope: All entries</span>
            </div>
            <CategoryChart entries={visibleEntries} isDark={isDark} />
          </div>
          <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Category Distribution</h2>
              <span className="text-xs opacity-70">Scope: All entries</span>
            </div>
            <CategoryPieChart entries={visibleEntries} isDark={isDark} />
          </div>
        </div>
      ) : filterMode === "today" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 grid grid-rows-2 content-between gap-6 h-full">
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Spending by Category</h2>
                  <span className="text-xs opacity-70">Scope: Today</span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    Category Distribution
                  </h2>
                  <span className="text-xs opacity-70">Scope: Today</span>
                </div>
                <CategoryPieChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Today's Transactions</h2>
                <span className="text-xs opacity-70">
                  {visibleEntries.length} entries
                </span>
              </div>
              <EntriesTable entries={visibleEntries} showAll={true} />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 grid grid-rows-2 content-between gap-6 h-full">
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Spending by Category</h2>
                  <span className="text-xs opacity-70">
                    Scope: Selected week
                  </span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>

            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    Category Distribution
                  </h2>
                  <span className="text-xs opacity-70">
                    Scope: Selected week
                  </span>
                </div>
                <CategoryPieChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Week's Transactions</h2>
                <span className="text-xs opacity-70">
                  {visibleEntries.length} entries
                </span>
              </div>
              <EntriesTable entries={visibleEntries} showAll={true} />
            </div>
          </div>
        </div>
      )}

      {/* All Entries Table */}
      <EntriesTable entries={visibleEntries} showAll={filterMode === "all"} />

      {/* Quick Stats Footer */}
      <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
        <h2 className="text-lg font-semibold mb-4">Quick Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Highest Transaction
            </p>
            <p className="text-lg font-bold">{formatPrice(highestTransaction.price)}</p>
            <p className="text-xs text-gray-400 truncate">
              {highestTransaction.product_name}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Completion Rate
            </p>
            <p className="text-lg font-bold">
              {totalSpent > 0 ? ((completedTotal / totalSpent) * 100).toFixed(0) : 0}%
            </p>
            <p className="text-xs text-gray-400">of budget spent</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Planned Items
            </p>
            <p className="text-lg font-bold">
              {visibleEntries.filter((e) => e.status === "planned").length}
            </p>
            <p className="text-xs text-gray-400">pending payment</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Completed Items
            </p>
            <p className="text-lg font-bold">
              {visibleEntries.filter((e) => e.status === "done").length}
            </p>
            <p className="text-xs text-gray-400">paid</p>
          </div>
        </div>
      </div>
    </main>
  );
}
