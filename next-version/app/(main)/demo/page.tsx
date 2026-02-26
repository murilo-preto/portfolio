"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "../../../components/entries/Card";
import { WeekNavigator } from "../../../components/entries/WeekNavigator";
import { CategoryChart } from "../../../components/entries/CategoryChart";
import { WeeklyCalendar } from "../../../components/entries/WeeklyCalendar";
import { EntriesTable } from "../../../components/entries/EntriesTable";
import { getMondayOf, addDays } from "../../../components/entries/utils";
import { DEMO_DATA } from "./constants";

export default function EntriesDemo() {
  const data = DEMO_DATA;

  const [isDark, setIsDark] = useState(false);
  const [weekStart, setWeekStart] = useState(() =>
    getMondayOf(new Date("2026-02-16")),
  );
  const [showAll, setShowAll] = useState(false);

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
    return data.entries.filter((entry) => {
      const start = new Date(entry.start_time);
      return start >= weekStart && start <= weekEndInclusive;
    });
  }, [data, weekStart, weekEnd]);

  const visibleEntries = showAll ? data.entries : filteredEntries;

  const totalHours = (
    visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0) / 3600
  ).toFixed(1);

  const longestSessionHours = (
    Math.max(0, ...visibleEntries.map((e) => e.duration_seconds)) / 3600
  ).toFixed(2);

  return (
    <main className="flex-1 p-4 md:p-6 space-y-8 md:space-y-12 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">
          {data.username}'s Dashboard
        </h1>
        <p className="text-sm text-gray-500">Static Demo Version</p>
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

      <CategoryChart
        entries={visibleEntries}
        isDark={isDark}
        showAll={showAll}
      />

      {!showAll && (
        <WeeklyCalendar
          weekStart={weekStart}
          entries={filteredEntries}
          isDark={isDark}
        />
      )}

      <EntriesTable entries={visibleEntries} showAll={showAll} />
    </main>
  );
}
