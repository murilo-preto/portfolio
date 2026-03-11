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
              className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-5 h-5 flex items-center justify-center rounded-full bg-gray-200 dark:bg-neutral-700">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {cat.category}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {(cat.duration / 3600).toFixed(1)}h
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {cat.count} sessions
                </p>
              </div>
            </div>
          ))}
          {topCategories.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No entries to display
            </p>
          )}
        </div>
      )}

      {/* Compact Mode - Stats Grid */}
      {compact && !showCategoriesOnly && (
        <div className="grid grid-cols-2 gap-3">
          {mostFrequentCategory && (
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">Most Frequent</p>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                {mostFrequentCategory[0]}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {mostFrequentCategory[1]} sessions
              </p>
            </div>
          )}
          {topCategoryByTime && (
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">Top Category</p>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                {(topCategoryByTime[1] / 3600).toFixed(1)}h
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {topCategoryByTime[0]}
              </p>
            </div>
          )}
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Avg. Session</p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {formatDuration(Math.round(avgDuration))}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">per entry</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Active Days</p>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {uniqueDays}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">unique days</p>
          </div>
        </div>
      )}

      {/* Full Mode - Default */}
      {!compact && !showCategoriesOnly && (
        <>
          {/* Most Frequent Category */}
          {mostFrequentCategory && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Most Frequent</p>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[120px]">
                {mostFrequentCategory[0]}
              </p>
            </div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {mostFrequentCategory[1]} sessions
            </p>
          </div>
        )}

        {/* Top Category by Time */}
        {topCategoryByTime && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Top Category</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">by time spent</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate max-w-[100px]">
                {topCategoryByTime[0]}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {(topCategoryByTime[1] / 3600).toFixed(1)}h
              </p>
            </div>
          </div>
        )}

        {/* Average Session */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Avg. Session</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">per entry</p>
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {formatDuration(Math.round(avgDuration))}
          </p>
        </div>

        {/* Active Days */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-neutral-800">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Active Days</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">unique days</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {uniqueDays}
          </p>
        </div>

        {/* Top Categories List */}
        {topCategories.length > 0 && (
          <div className="pt-2 border-t border-gray-200 dark:border-neutral-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Top Categories
            </p>
            <div className="space-y-2">
              {topCategories.map((cat, index) => (
                <div
                  key={cat.category}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 w-4">
                      #{index + 1}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {cat.category}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
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
