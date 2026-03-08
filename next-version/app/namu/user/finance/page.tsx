"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/finance/EntriesTable";
import { WeekNavigator } from "@/components/finance/WeekNavigator";
import { CategoryChart } from "@/components/finance/CategoryChart";
import { CategoryPieChart } from "@/components/finance/CategoryPieChart";
import { EntriesTable } from "@/components/finance/EntriesTable";
import { getMondayOf, addDays, formatPrice } from "@/components/finance/utils";
import type { ApiResponse, FinanceEntry } from "@/components/finance/types";

type FilterMode = "today" | "week" | "all";

export default function FinanceDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [filterMode, setFilterMode] = useState<FilterMode>("week");

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

  useEffect(() => {
    getEntries();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const weekEnd = addDays(weekStart, 6);

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    const weekEndInclusive = addDays(weekEnd, 1);

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

    return data.entries.filter((entry) => {
      const date = new Date(entry.purchase_date);
      return date >= weekStart && date <= weekEndInclusive;
    });
  }, [data, weekStart, weekEnd, filterMode]);

  const visibleEntries =
    filterMode === "all" ? (data?.entries ?? []) : filteredEntries;

  // Calculate statistics
  const totalSpent = visibleEntries.reduce((acc, e) => acc + e.price, 0);
  const plannedTotal = visibleEntries
    .filter((e) => e.status === "planned")
    .reduce((acc, e) => acc + e.price, 0);
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
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {data.username}'s Finance Dashboard
          </h1>
          <p className="text-sm text-gray-500">Spending Overview</p>
        </div>
        <a
          href="/namu/user/finance/manage"
          className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
        >
          Manage Finance
        </a>
      </div>

      <WeekNavigator
        weekStart={weekStart}
        weekEnd={weekEnd}
        filterMode={filterMode}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
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
