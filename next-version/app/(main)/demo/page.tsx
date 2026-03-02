"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/entries/Card";
import { WeekNavigator } from "@/components/entries/WeekNavigator";
import { CategoryChart } from "@/components/entries/CategoryChart";
import { CategoryPieChart } from "@/components/entries/CategoryPieChart";
import { WeeklyCalendar } from "@/components/entries/WeeklyCalendar";
import { EntriesTable } from "@/components/entries/EntriesTable";
import { getMondayOf, addDays } from "@/components/entries/utils";
import { DEMO_DATA } from "./constants";

type FilterMode = "today" | "week" | "all";

export default function EntriesDemo() {
  const data = DEMO_DATA;

  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() =>
    getMondayOf(new Date("2026-02-18")),
  );
  const [filterMode, setFilterMode] = useState<FilterMode>("week");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(media.matches);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const weekEnd = addDays(weekStart, 6);

  const filteredEntries = useMemo(() => {
    const weekEndInclusive = addDays(weekEnd, 1);

    if (filterMode === "today") {
      const today = new Date("2026-02-23");
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

  const visibleEntries = filterMode === "all" ? data.entries : filteredEntries;

  const totalHours = (
    visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0) / 3600
  ).toFixed(1);

  const longestSessionHours = (
    Math.max(0, ...visibleEntries.map((e) => e.duration_seconds)) / 3600
  ).toFixed(2);

  return (
    <main className="flex-1 p-4 md:p-6 space-y-8 md:space-y-12 max-w-4/5 mx-auto">
      {/* Non showAll reliant */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {data.username}'s Dashboard
        </h1>
        <p className="text-sm text-gray-500">Static Demo Version</p>
      </div>

      <WeekNavigator
        weekStart={weekStart}
        weekEnd={weekEnd}
        filterMode={filterMode}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onFilterModeChange={setFilterMode}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card title="Total Hours" value={`${totalHours}h`} />
        <Card title="Sessions" value={visibleEntries.length} />
        <Card title="Longest Session" value={`${longestSessionHours}h`} />
      </div>

      {/* filterMode reliant */}
      {filterMode === "all" ? (
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
            {/* --- First row of First column ---*/}
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Hours per category</h2>
                  <span className="text-xs opacity-70">
                    Scope: {filterMode === "today" ? "Today" : "Selected week"}
                  </span>
                </div>
                <CategoryChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>

            {/* --- Second row of First column ---*/}
            <div className="row-span-1">
              <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white h-full">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    Relative time per category
                  </h2>
                  <span className="text-xs opacity-70">
                    Scope: {filterMode === "today" ? "Today" : "Selected week"}
                  </span>
                </div>
                <CategoryPieChart entries={visibleEntries} isDark={isDark} />
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <WeeklyCalendar
              weekStart={
                filterMode === "today"
                  ? new Date(new Date("2026-02-23").setHours(0, 0, 0, 0))
                  : weekStart
              }
              entries={filteredEntries}
              isDark={isDark}
            />
          </div>
        </div>
      )}

      <EntriesTable entries={visibleEntries} showAll={filterMode === "all"} />
    </main>
  );
}
