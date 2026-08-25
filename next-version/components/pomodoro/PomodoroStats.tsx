"use client";

import { useEffect, useState } from "react";
import type { PomodoroStats as PomodoroStatsType } from "@/lib/types";
import { formatDuration } from "@/components/todo/utils";
import { warmFetch } from "@/lib/prefetch";

export function PomodoroStats() {
  const [stats, setStats] = useState<PomodoroStatsType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await warmFetch("/api/pomodoro/stats", {
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
      <div className="bg-surface p-5 rounded-xl shadow-sm border border-subtle">
        <p className="text-sm text-muted">Loading stats...</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <div className="bg-surface p-5 rounded-xl shadow-sm border border-subtle">
      <h2 className="text-sm font-semibold text-primary mb-4">
        Pomodoro Stats
      </h2>
      <div className="space-y-3">
        {/* Today */}
        <div className="p-3 rounded-lg bg-gradient-to-br from-tint-red-a to-tint-red-b border border-tint-red-line">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">Today (focus)</p>
              <p className="text-lg font-bold text-primary">
                {stats.stats.today.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-red-500">
              {formatDuration(stats.stats.today.total_seconds)}
            </p>
          </div>
        </div>

        {/* Today's breaks */}
        <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/10 border border-tint-green-a">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">Today (breaks)</p>
              <p className="text-lg font-semibold text-primary">
                {stats.stats.today_breaks.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-tint-green-ink dark:text-green-400">
              {formatDuration(stats.stats.today_breaks.total_seconds)}
            </p>
          </div>
        </div>

        {/* This Week */}
        <div className="p-3 rounded-lg bg-surface-inset">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">This Week</p>
              <p className="text-lg font-semibold text-primary">
                {stats.stats.week.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-muted">
              {formatDuration(stats.stats.week.total_seconds)}
            </p>
          </div>
        </div>

        {/* Total */}
        <div className="p-3 rounded-lg bg-surface-inset">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">Total</p>
              <p className="text-lg font-semibold text-primary">
                {stats.stats.total.sessions} sessions
              </p>
            </div>
            <p className="text-sm font-medium text-muted">
              {formatDuration(stats.stats.total.total_seconds)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
