"use client";

import { useMemo } from "react";

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
};

type QuickStatsProps = {
  entries: Entry[];
  loading?: boolean;
};

export function QuickStats({ entries, loading = false }: QuickStatsProps) {
  const { todaySeconds, sessionCount, topCategory } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEntries = entries.filter(
      (e) => new Date(e.start_time) >= today
    );

    const totalSeconds = todayEntries.reduce(
      (acc, e) => acc + e.duration_seconds,
      0
    );

    const categoryTime: Record<string, number> = {};
    todayEntries.forEach((e) => {
      categoryTime[e.category] =
        (categoryTime[e.category] || 0) + e.duration_seconds;
    });
    const topCat =
      Object.entries(categoryTime).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      todaySeconds: totalSeconds,
      sessionCount: todayEntries.length,
      topCategory: topCat,
    };
  }, [entries]);

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
      <div className="bg-surface p-5 rounded-xl shadow-sm border border-subtle">
        <p className="text-sm text-muted">Loading stats...</p>
      </div>
    );
  }

  return (
    <div className="bg-surface p-5 rounded-xl shadow-sm border border-subtle">
      <h2 className="text-sm font-semibold text-primary mb-4">
        Today&apos;s Activity
      </h2>
      <div className="space-y-4">
        {/* Total Time */}
        <div className="p-3 rounded-lg bg-gradient-to-br from-tint-blue-a to-tint-blue-b border border-tint-blue-line">
          <p className="text-xs text-muted">Total Time</p>
          <p className="text-2xl font-bold text-primary">
            {formatHours(todaySeconds)}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface-inset">
            <p className="text-xs text-muted">Sessions</p>
            <p className="text-lg font-semibold text-primary">
              {sessionCount}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-surface-inset">
            <p className="text-xs text-muted">Top Category</p>
            <p className="text-sm font-semibold text-primary truncate">
              {topCategory || "—"}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
