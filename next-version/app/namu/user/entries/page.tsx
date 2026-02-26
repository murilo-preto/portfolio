"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

import { LIGHT_PALETTE, DARK_PALETTE } from "@/components/entries/colors";
import { Card } from "@/components/entries/Card";
import { WeekNavigator } from "@/components/entries/WeekNavigator";
import { WeeklyCalendar } from "@/components/entries/WeeklyCalendar";

function getMondayOf(d: Date) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time: string;
};

type ApiResponse = {
  username: string;
  entries: Entry[];
};

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
    } catch (err: any) {
      setError(err.message);
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

  /* ── Derived Metrics ── */

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

  const totalSeconds = useMemo(() => {
    return visibleEntries.reduce((acc, e) => acc + e.duration_seconds, 0);
  }, [visibleEntries]);

  const totalHours = (totalSeconds / 3600).toFixed(1);
  const sessionsCount = visibleEntries.length;

  const longestSession = useMemo(() => {
    if (visibleEntries.length === 0) return 0;
    return Math.max(...visibleEntries.map((e) => e.duration_seconds));
  }, [visibleEntries]);

  const longestSessionHours = (longestSession / 3600).toFixed(2);

  const categoryBreakdown = useMemo(() => {
    if (!data) return [];
    const graph_palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
    const grouped: Record<string, number> = {};
    visibleEntries.forEach((entry) => {
      grouped[entry.category] =
        (grouped[entry.category] || 0) + entry.duration_seconds;
    });
    return Object.entries(grouped).map(([category, seconds], index) => ({
      category,
      hours: +(seconds / 3600).toFixed(2),
      fill: graph_palette[index % graph_palette.length],
    }));
  }, [visibleEntries, isDark]);

  function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  if (loading) return <main className="p-4">Loading dashboard...</main>;
  if (error) return <main className="p-4 text-red-500">{error}</main>;
  if (!data) return null;

  return (
    <main className="flex-1 p-4 md:p-6 space-y-8 md:space-y-12 max-w-6xl mx-auto">
      {/* ── Header ── */}
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

      {/* ── Row 1: Stats Cards ── */}
      {/* 1 col on mobile, 3 cols on md+ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card title="Total Hours" value={`${totalHours}h`} />
        <Card title="Sessions" value={sessionsCount} />
        <Card title="Longest Session" value={`${longestSessionHours}h`} />
      </div>

      {/* ── Row 2: Bar Chart ── */}
      <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Hours by Category</h2>
          <span className="text-xs opacity-70">
            Scope: {showAll ? "All entries" : "Selected week"}
          </span>
        </div>

        {/* Shorter chart on mobile */}
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={categoryBreakdown}
            margin={{ top: 4, right: 4, left: -36, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="category"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={48}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              cursor={{
                fill: isDark ? "#262626" : "#e7e5e4",
              }}
            />
            <Bar dataKey="hours" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {!showAll && (
        <WeeklyCalendar
          weekStart={weekStart}
          entries={filteredEntries}
          isDark={isDark}
        />
      )}

      {/* ── Row 3: Detailed Table ── */}
      <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Detailed Entries</h2>
          <span className="text-xs opacity-70">
            Scope: {showAll ? "All entries" : "Selected week"}
          </span>
        </div>

        {/* 
          On mobile we switch to a card-list layout instead of a wide table.
          On md+ we show the classic table.
        */}

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {visibleEntries.map((entry) => (
            <div
              key={entry.id}
              className="border border-[#F3ECE3] dark:border-neutral-800 rounded-lg p-3 space-y-1"
            >
              <div className="flex justify-between items-center">
                <span className="font-medium">{entry.category}</span>
                <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                  {formatDuration(entry.duration_seconds)}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <p>Start: {new Date(entry.start_time).toLocaleString()}</p>
                <p>End: {new Date(entry.end_time).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#F3ECE3] dark:border-neutral-800">
                <th className="py-2">Category</th>
                <th>Start</th>
                <th>End</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-[#F3ECE3] dark:border-neutral-800 hover:bg-[#F3ECE3] dark:hover:bg-neutral-700 transition"
                >
                  <td className="py-2">{entry.category}</td>
                  <td>{new Date(entry.start_time).toLocaleString()}</td>
                  <td>{new Date(entry.end_time).toLocaleString()}</td>
                  <td>{formatDuration(entry.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
