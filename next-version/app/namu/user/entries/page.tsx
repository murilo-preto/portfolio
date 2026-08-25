"use client";

import { useEffect, useMemo, useState } from "react";
import { WeekNavigator } from "@/components/entries/WeekNavigator";
import { CategoryChart } from "@/components/entries/CategoryChart";
import { CategoryPieChart } from "@/components/entries/CategoryPieChart";
import { WeeklyCalendar } from "@/components/entries/WeeklyCalendar";
import { EntriesTable } from "@/components/entries/EntriesTable";
import { Panel } from "@/components/entries/Panel";
import { SummaryCard } from "@/components/finance/SummaryCard";
import {
  getMondayOf,
  addDays,
  stripTime,
  formatDuration,
} from "@/components/entries/utils";
import type { ApiResponse } from "@/components/entries/types";
import { usePrefersDark } from "@/lib/use-media-query";

type FilterMode = "today" | "week" | "all";

export default function Entries() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDark = usePrefersDark();
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [filterMode, setFilterMode] = useState<FilterMode>("week");

  useEffect(() => {
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

    get_entries();
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

  const showAll = filterMode === "all";
  const visibleEntries = useMemo(
    () => (showAll ? (data?.entries ?? []) : filteredEntries),
    [showAll, data, filteredEntries],
  );

  const totalSeconds = visibleEntries.reduce(
    (acc, e) => acc + e.duration_seconds,
    0,
  );
  const totalHours = (totalSeconds / 3600).toFixed(1);

  const longestSessionHours = (
    Math.max(0, ...visibleEntries.map((e) => e.duration_seconds)) / 3600
  ).toFixed(2);

  const avgSessionSeconds =
    visibleEntries.length > 0 ? totalSeconds / visibleEntries.length : 0;

  const activeDays = useMemo(
    () =>
      new Set(
        visibleEntries.map((e) => stripTime(new Date(e.start_time)).getTime()),
      ).size,
    [visibleEntries],
  );

  // "today" pins the calendar to the current day; every other mode uses the
  // selected week. The surrounding layout is identical, so it stays one branch.
  const calendarStart = filterMode === "today" ? stripTime(new Date()) : weekStart;

  if (loading) {
    return (
      <main className="flex-1 p-4 md:p-6 flex items-center justify-center">
        <div className="text-muted">Loading dashboard...</div>
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">
            {data.username}&apos;s Dashboard
          </h1>
          <p className="text-sm text-muted mt-1">
            Track your time and productivity
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/namu/user/manage"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-invert hover:bg-invert-hover transition-colors text-invert-fg"
          >
            Add Entry
          </a>
        </div>
      </div>

      {/* Scope control — the single place the active period is stated */}
      <WeekNavigator
        weekStart={weekStart}
        weekEnd={weekEnd}
        filterMode={filterMode}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onFilterModeChange={setFilterMode}
      />

      {/* Headline metrics — each one appears here and nowhere else */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Hours"
          value={`${totalHours}h`}
          subtitle={`${visibleEntries.length} ${visibleEntries.length === 1 ? "session" : "sessions"}`}
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Active Days"
          value={activeDays}
          subtitle="Days with entries"
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

      {/* Analysis: supporting charts beside the focus panel. The frame is the
          same in every mode so switching scope never reflows the page. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* Both panels absorb the leftover height evenly, so the column ends
            flush with the calendar beside it. */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Panel title="Hours per Category" className="lg:flex-1 lg:min-h-0">
            <CategoryChart entries={visibleEntries} isDark={isDark} />
          </Panel>
          <Panel
            title="Relative Time per Category"
            className="lg:flex-1 lg:min-h-0"
          >
            <CategoryPieChart entries={visibleEntries} isDark={isDark} />
          </Panel>
        </div>

        <div className="lg:col-span-2">
          {showAll ? (
            <EntriesTable entries={visibleEntries} />
          ) : (
            <WeeklyCalendar
              weekStart={calendarStart}
              entries={filteredEntries}
              isDark={isDark}
            />
          )}
        </div>
      </div>

      {/* Detail — omitted in "all time", where it occupies the focus slot */}
      {!showAll && <EntriesTable entries={visibleEntries} />}
    </main>
  );
}
