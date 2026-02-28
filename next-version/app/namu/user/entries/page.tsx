"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/entries/Card";
import { WeekNavigator } from "@/components/entries/WeekNavigator";
import { CategoryChart } from "@/components/entries/CategoryChart";
import { CategoryPieChart } from "@/components/entries/CategoryPieChart";
import { WeeklyCalendar } from "@/components/entries/WeeklyCalendar";
import { EntriesTable } from "@/components/entries/EntriesTable";
import { getMondayOf, addDays } from "@/components/entries/utils";
import type { ApiResponse } from "@/components/entries/types";

export default function Entries() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [showAll, setShowAll] = useState(false);

  async function get_entries() {
    try {
      const res = await fetch("/api/entries", {
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
    return data.entries.filter((entry) => {
      const start = new Date(entry.start_time);
      return start >= weekStart && start <= weekEndInclusive;
    });
  }, [data, weekStart, weekEnd]);

  const visibleEntries = showAll ? (data?.entries ?? []) : filteredEntries;

  const totalHours = (
    visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0) / 3600
  ).toFixed(1);

  const longestSessionHours = (
    Math.max(0, ...visibleEntries.map((e) => e.duration_seconds)) / 3600
  ).toFixed(2);

  if (loading) return <main className="p-4">Loading dashboard...</main>;
  if (error) return <main className="p-4 text-red-500">{error}</main>;
  if (!data) return null;

  return (
    <main className="flex-1 p-4 md:p-6 space-y-8 md:space-y-12 max-w-4/5 mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {data.username}'s Dashboard
        </h1>
        <p className="text-sm text-gray-500">Weekly Overview</p>
      </div>

      <WeekNavigator
        weekStart={weekStart}
        weekEnd={weekEnd}
        showAll={showAll}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onToggleShowAll={() => setShowAll((s) => !s)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card title="Total Hours" value={`${totalHours}h`} />
        <Card title="Sessions" value={visibleEntries.length} />
        <Card title="Longest Session" value={`${longestSessionHours}h`} />
      </div>

      {showAll ? (
        <div className="grid grid-cols-2 gap-6">
          <div className="col-span-1">
            <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Hours by Category</h2>
                <span className="text-xs opacity-70">
                  Scope: {"All entries"}
                </span>
              </div>
              <CategoryChart entries={visibleEntries} isDark={isDark} />
            </div>
          </div>
          <div className="col-span-1">
            <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Relative time</h2>
                <span className="text-xs opacity-70">
                  Scope: {"All entries"}
                </span>
              </div>
              <CategoryPieChart entries={visibleEntries} isDark={isDark} />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 grid grid-rows-2 content-between gap-6 h-full">
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
<h2 className="text-lg font-semibold">Hours per category</h2>
                  <span className="text-xs opacity-70">
                    Scope: {"Selected week"}
                  </span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>

            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    Relative time per category
                  </h2>
                  <span className="text-xs opacity-70">
                    Scope: {"Selected week"}
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

      <EntriesTable entries={visibleEntries} showAll={showAll} />
    </main>
  );
}
