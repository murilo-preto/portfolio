"use client";

import { useEffect, useState } from "react";
import type { PomodoroStats as PomodoroStatsType } from "@/lib/types";
import { formatDuration } from "@/components/todo/utils";

export function PomodoroStats() {
  const [stats, setStats] = useState<PomodoroStatsType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/pomodoro/stats", {
          credentials: "include",
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to fetch stats");
        }

        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Failed to fetch Pomodoro stats:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
        <p className="text-sm text-gray-400">Loading stats...</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Pomodoro Stats
      </h2>
      <div className="space-y-3">
        {/* Today */}
        <div className="p-3 rounded-lg bg-gradient-to-br from-red-500/10 to-red-600/5 border border-red-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Today (focus)</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {stats.stats.today.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-red-500">
              {formatDuration(stats.stats.today.total_seconds)}
            </p>
          </div>
        </div>

        {/* Today's breaks */}
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-green-500/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Today (breaks)</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {stats.stats.today_breaks.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              {formatDuration(stats.stats.today_breaks.total_seconds)}
            </p>
          </div>
        </div>

        {/* This Week */}
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">This Week</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {stats.stats.week.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {formatDuration(stats.stats.week.total_seconds)}
            </p>
          </div>
        </div>

        {/* Total */}
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {stats.stats.total.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {formatDuration(stats.stats.total.total_seconds)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
