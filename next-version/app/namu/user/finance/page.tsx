"use client";

import { useEffect, useMemo, useState } from "react";
import { WeekNavigator } from "@/components/finance/WeekNavigator";
import { CategoryChart } from "@/components/finance/CategoryChart";
import { CategoryPieChart } from "@/components/finance/CategoryPieChart";
import { EntriesTable } from "@/components/finance/EntriesTable";
import { getMondayOf, addDays, formatPrice } from "@/components/finance/utils";
import { SummaryCard } from "@/components/finance/SummaryCard";
import { RecurringSummary } from "@/components/finance/RecurringSummary";
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

  // Completion rate
  const completionRate = totalSpent > 0 ? ((completedTotal / totalSpent) * 100).toFixed(0) : 0;

  // Planned items count
  const plannedCount = visibleEntries.filter((e) => e.status === "planned").length;
  const completedCount = visibleEntries.filter((e) => e.status === "done").length;

  if (loading) {
    return (
      <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading finance dashboard...</div>
      </main>
    );
  }
  
  if (error) {
    return (
      <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <div className="text-red-500">{error}</div>
      </main>
    );
  }
  
  if (!data) return null;

  return (
    <main className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {data.username}'s Finance Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track your spending and manage your budget
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/namu/user/finance/recurring"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors text-gray-700 dark:text-gray-200"
          >
            Recurring
          </a>
          <a
            href="/namu/user/finance/manage"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-neutral-800 dark:bg-neutral-100 hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors text-white dark:text-neutral-900"
          >
            Manage Entries
          </a>
        </div>
      </div>

      {/* Week Navigator */}
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
        <SummaryCard
          title="Total Spent"
          value={formatPrice(totalSpent)}
          subtitle={`${entryCount} transactions`}
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Planned"
          value={formatPrice(plannedTotal)}
          subtitle="Pending payments"
          accentColor="amber"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Completed"
          value={formatPrice(completedTotal)}
          subtitle={`${completionRate}% of total`}
          accentColor="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Avg. Transaction"
          value={formatPrice(avgTransaction)}
          subtitle="Per entry"
          accentColor="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          }
        />
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Charts and Table */}
        <div className="lg:col-span-2 space-y-6">
          {/* Bar Chart */}
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Spending by Category
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {filterMode === "all" ? "All entries" : filterMode === "today" ? "Today" : filterMode === "month" ? "This month" : "This week"}
              </span>
            </div>
            <CategoryChart entries={visibleEntries} isDark={isDark} />
          </div>

          {/* Transactions Table */}
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Transactions
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {visibleEntries.length} entries
              </span>
            </div>
            <EntriesTable entries={visibleEntries} showAll={filterMode === "all"} />
          </div>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Recurring Expenses Summary */}
          <RecurringSummary recurringExpenses={recurringExpenses} />

          {/* Pie Chart */}
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Category Distribution
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {filterMode === "all" ? "All time" : filterMode === "today" ? "Today" : filterMode === "month" ? "This month" : "This week"}
              </span>
            </div>
            <CategoryPieChart entries={visibleEntries} isDark={isDark} height={250} />
          </div>

          {/* Quick Stats */}
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Quick Stats
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Highest Transaction</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[120px]">
                    {highestTransaction.product_name}
                  </p>
                </div>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {formatPrice(highestTransaction.price)}
                </p>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Completion Rate</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">of budget spent</p>
                </div>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {completionRate}%
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Planned</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {plannedCount}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">pending</p>
                </div>
                <div className="p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {completedCount}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">paid</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
