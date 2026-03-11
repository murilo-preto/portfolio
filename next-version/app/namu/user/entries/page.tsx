"use client";

import { useEffect, useMemo, useState } from "react";
import { WeekNavigator } from "@/components/entries/WeekNavigator";
import { CategoryChart } from "@/components/entries/CategoryChart";
import { CategoryPieChart } from "@/components/entries/CategoryPieChart";
import { WeeklyCalendar } from "@/components/entries/WeeklyCalendar";
import { EntriesTable } from "@/components/entries/EntriesTable";
import { QuickStats } from "@/components/entries/QuickStats";
import { SummaryCard } from "@/components/finance/SummaryCard";
import { getMondayOf, addDays, formatDuration } from "@/components/entries/utils";
import type { ApiResponse } from "@/components/entries/types";

type FilterMode = "today" | "week" | "all";

export default function Entries() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [filterMode, setFilterMode] = useState<FilterMode>("week");

  async function get_entries() {
    try {
      const res = await fetch("/api/entry", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch entries");
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
    get_entries();
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
        const start = new Date(entry.start_time);
        return start >= todayStart && start <= todayEnd;
      });
    }

    return data.entries.filter((entry) => {
      const start = new Date(entry.start_time);
      return start >= weekStart && start <= weekEndInclusive;
    });
  }, [data, weekStart, weekEnd, filterMode]);

  const visibleEntries =
    filterMode === "all" ? (data?.entries ?? []) : filteredEntries;

  const totalHours = (
    visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0) / 3600
  ).toFixed(1);

  const longestSessionSeconds = Math.max(0, ...visibleEntries.map((e) => e.duration_seconds));
  const longestSessionHours = (longestSessionSeconds / 3600).toFixed(2);

  const avgSessionSeconds = visibleEntries.length > 0
    ? visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0) / visibleEntries.length
    : 0;

  if (loading) {
    return (
      <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading dashboard...</div>
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
            {data.username}'s Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track your time and productivity
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/namu/user/entries/manage"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-neutral-800 dark:bg-neutral-100 hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors text-white dark:text-neutral-900"
          >
            Add Entry
          </a>
        </div>
      </div>

      {/* Week Navigator */}
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
        <SummaryCard
          title="Total Hours"
          value={`${totalHours}h`}
          subtitle={`${visibleEntries.length} sessions`}
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Sessions"
          value={visibleEntries.length}
          subtitle={filterMode === "all" ? "All time" : filterMode === "today" ? "Today" : "This week"}
          accentColor="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Longest Session"
          value={`${longestSessionHours}h`}
          subtitle="Single session"
          accentColor="amber"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          }
        />
        <SummaryCard
          title="Avg. Session"
          value={formatDuration(Math.round(avgSessionSeconds))}
          subtitle="Per entry"
          accentColor="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
      </div>

      {/* Main Content - Previous Layout */}
      {filterMode === "all" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Hours by Category</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Scope: All entries
              </span>
            </div>
            <CategoryChart entries={visibleEntries} isDark={isDark} />
          </div>
          <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Time Distribution</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Scope: All entries
              </span>
            </div>
            <CategoryPieChart entries={visibleEntries} isDark={isDark} />
          </div>
        </div>
      ) : filterMode === "today" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 grid grid-rows-2 content-between gap-6 h-full">
            <div className="row-span-1">
              <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Hours per Category</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Scope: Today</span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
            <div className="row-span-1">
              <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Relative Time per Category
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Scope: Today</span>
                </div>
                <CategoryPieChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
          </div>
          <div className="lg:col-span-2">
            <WeeklyCalendar
              weekStart={new Date(new Date().setHours(0, 0, 0, 0))}
              entries={filteredEntries}
              isDark={isDark}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 grid grid-rows-2 content-between gap-6 h-full">
            <div className="row-span-1">
              <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Hours per Category</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Scope: Selected week
                  </span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>

            <div className="row-span-1">
              <div className="bg-white dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Relative Time per Category
                  </h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Scope: Selected week
                  </span>
                </div>
                <CategoryPieChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <WeeklyCalendar
              weekStart={weekStart}
              entries={filteredEntries}
              isDark={isDark}
            />
          </div>
        </div>
      )}

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Overview Stats
          </h2>
          <QuickStats entries={visibleEntries} compact />
        </div>
        <div className="bg-white dark:bg-neutral-900 p-4 md:p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Category Breakdown
          </h2>
          <QuickStats entries={visibleEntries} showCategoriesOnly />
        </div>
      </div>

      {/* Entries Table */}
      <EntriesTable entries={visibleEntries} showAll={filterMode === "all"} />
    </main>
  );
}
