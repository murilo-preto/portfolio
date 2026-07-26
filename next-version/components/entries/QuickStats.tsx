"use client";

import { Entry } from "@/components/entries/types";
import { formatDuration } from "@/components/entries/utils";

type QuickStatsProps = {
  entries: Entry[];
  compact?: boolean;
  showCategoriesOnly?: boolean;
};

export function QuickStats({ entries, compact = false, showCategoriesOnly = false }: QuickStatsProps) {
  // Calculate category frequency
  const categoryCount: Record<string, number> = {};
  const categoryDuration: Record<string, number> = {};
  
  entries.forEach((entry) => {
    categoryCount[entry.category] = (categoryCount[entry.category] || 0) + 1;
    categoryDuration[entry.category] = (categoryDuration[entry.category] || 0) + entry.duration_seconds;
  });

  // Find most frequent category
  const mostFrequentCategory = Object.entries(categoryCount).sort((a, b) => b[1] - a[1])[0];
  
  // Find category with most time spent
  const topCategoryByTime = Object.entries(categoryDuration).sort((a, b) => b[1] - a[1])[0];

  // Calculate average session duration
  const avgDuration = entries.length > 0
    ? entries.reduce((acc, e) => acc + e.duration_seconds, 0) / entries.length
    : 0;

  // Calculate unique days with entries (streak-like metric)
  const uniqueDays = new Set(
    entries.map((e) => {
      const d = new Date(e.start_time);
      return d.toISOString().split("T")[0];
    })
  ).size;

  // Get top 3 categories by time
  const topCategories = Object.entries(categoryDuration)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, duration]) => ({
      category,
      duration,
      count: categoryCount[category],
    }));

  return (
    <div className="space-y-3">
      {/* Show Categories Only Mode */}
      {showCategoriesOnly && (
        <div className="space-y-2">
          {topCategories.map((cat, index) => (
            <div
              key={cat.category}
              className="flex items-center justify-between p-2 rounded-lg bg-surface-inset"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-dim w-5 h-5 flex items-center justify-center rounded-full bg-surface-hover">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-secondary">
                  {cat.category}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">
                  {(cat.duration / 3600).toFixed(1)}h
                </p>
                <p className="text-xs text-muted">
                  {cat.count} sessions
                </p>
              </div>
            </div>
          ))}
          {topCategories.length === 0 && (
            <p className="text-sm text-muted text-center py-4">
              No entries to display
            </p>
          )}
        </div>
      )}

      {/* Compact Mode - Stats Grid */}
      {compact && !showCategoriesOnly && (
        <div className="grid grid-cols-2 gap-3">
          {mostFrequentCategory && (
            <div className="p-3 rounded-lg bg-surface-inset">
              <p className="text-xs text-muted">Most Frequent</p>
              <p className="text-sm font-bold text-primary truncate">
                {mostFrequentCategory[0]}
              </p>
              <p className="text-xs text-dim">
                {mostFrequentCategory[1]} sessions
              </p>
            </div>
          )}
          {topCategoryByTime && (
            <div className="p-3 rounded-lg bg-surface-inset">
              <p className="text-xs text-muted">Top Category</p>
              <p className="text-sm font-bold text-primary truncate">
                {(topCategoryByTime[1] / 3600).toFixed(1)}h
              </p>
              <p className="text-xs text-dim truncate">
                {topCategoryByTime[0]}
              </p>
            </div>
          )}
          <div className="p-3 rounded-lg bg-surface-inset">
            <p className="text-xs text-muted">Avg. Session</p>
            <p className="text-sm font-bold text-primary">
              {formatDuration(Math.round(avgDuration))}
            </p>
            <p className="text-xs text-dim">per entry</p>
          </div>
          <div className="p-3 rounded-lg bg-surface-inset">
            <p className="text-xs text-muted">Active Days</p>
            <p className="text-sm font-bold text-primary">
              {uniqueDays}
            </p>
            <p className="text-xs text-dim">unique days</p>
          </div>
        </div>
      )}

      {/* Full Mode - Default */}
      {!compact && !showCategoriesOnly && (
        <>
          {/* Most Frequent Category */}
          {mostFrequentCategory && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-inset">
            <div>
              <p className="text-xs text-muted">Most Frequent</p>
              <p className="text-sm font-medium text-primary truncate max-w-[120px]">
                {mostFrequentCategory[0]}
              </p>
            </div>
            <p className="text-sm font-bold text-primary">
              {mostFrequentCategory[1]} sessions
            </p>
          </div>
        )}

        {/* Top Category by Time */}
        {topCategoryByTime && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-inset">
            <div>
              <p className="text-xs text-muted">Top Category</p>
              <p className="text-xs text-dim">by time spent</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-primary truncate max-w-[100px]">
                {topCategoryByTime[0]}
              </p>
              <p className="text-xs text-muted">
                {(topCategoryByTime[1] / 3600).toFixed(1)}h
              </p>
            </div>
          </div>
        )}

        {/* Average Session */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-surface-inset">
          <div>
            <p className="text-xs text-muted">Avg. Session</p>
            <p className="text-xs text-dim">per entry</p>
          </div>
          <p className="text-sm font-bold text-primary">
            {formatDuration(Math.round(avgDuration))}
          </p>
        </div>

        {/* Active Days */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-surface-inset">
          <div>
            <p className="text-xs text-muted">Active Days</p>
            <p className="text-xs text-dim">unique days</p>
          </div>
          <p className="text-lg font-bold text-primary">
            {uniqueDays}
          </p>
        </div>

        {/* Top Categories List */}
        {topCategories.length > 0 && (
          <div className="pt-2 border-t border-default">
            <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
              Top Categories
            </p>
            <div className="space-y-2">
              {topCategories.map((cat, index) => (
                <div
                  key={cat.category}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-dim w-4">
                      #{index + 1}
                    </span>
                    <span className="text-sm text-secondary">
                      {cat.category}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-muted">
                    {(cat.duration / 3600).toFixed(1)}h
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}
