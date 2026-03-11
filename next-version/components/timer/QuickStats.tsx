"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
};

type QuickStatsProps = {
  currentCategoryId?: number | null;
};

export function QuickStats({ currentCategoryId }: QuickStatsProps) {
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [topCategory, setTopCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTodayStats() {
      try {
        const res = await fetch("/api/entry", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch entries");
        const json = await res.json();
        const entries: Entry[] = json.entries ?? [];

        // Filter today's entries
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayEntries = entries.filter(
          (e) => new Date(e.start_time) >= today
        );

        // Calculate total time today
        const totalSeconds = todayEntries.reduce(
          (acc, e) => acc + e.duration_seconds,
          0
        );

        // Find top category
        const categoryTime: Record<string, number> = {};
        todayEntries.forEach((e) => {
          categoryTime[e.category] =
            (categoryTime[e.category] || 0) + e.duration_seconds;
        });
        const topCat = Object.entries(categoryTime).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0] || null;

        setTodaySeconds(totalSeconds);
        setSessionCount(todayEntries.length);
        setTopCategory(topCat);
      } catch (err) {
        console.error("Failed to fetch stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchTodayStats();
  }, []);

  const formatHours = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}m`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <p className="text-sm text-gray-400">Loading stats...</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800 h-full">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Today's Activity
      </h2>
      <div className="space-y-4">
        {/* Total Time */}
        <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
          <p className="text-xs text-gray-500 dark:text-gray-400">Total Time</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {formatHours(todaySeconds)}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Sessions</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {sessionCount}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Top Category</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {topCategory || "—"}
            </p>
          </div>
        </div>

        {/* Current Category Indicator */}
        {currentCategoryId && (
          <div className="pt-3 border-t border-gray-200 dark:border-neutral-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Tracking category
            </p>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
              Select a category to start
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
