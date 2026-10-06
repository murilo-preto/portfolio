"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Entry } from "@/components/entries/types";
import { CHART_TOOLTIP_STYLE, useChartColors } from "@/lib/use-chart-colors";
import { fallbackSlots, type ColorSlots } from "@/components/entries/colors";
import { EmptyState } from "@/components/entries/EmptyState";

type CategoryChartProps = {
  entries: Entry[];
  /** The page's category → colour map, shared with its other charts. */
  colorSlots?: ColorSlots;
  height?: number; // optional, default 300
};

export function CategoryChart({
  entries,
  colorSlots,
  height = 300,
}: CategoryChartProps) {
  const colors = useChartColors();
  // One map for every chart on the page, so a category keeps its colour.
  const slots = colorSlots ?? fallbackSlots(entries.map((e) => e.category));

  const grouped: Record<string, number> = {};
  entries.forEach((entry) => {
    grouped[entry.category] =
      (grouped[entry.category] || 0) + entry.duration_seconds;
  });

  const data = Object.entries(grouped).map(([category, seconds]) => ({
    category,
    hours: +(seconds / 3600).toFixed(2),
    fill: colors.series[(slots.get(category) ?? 1) - 1],
  }));

  if (data.length === 0) {
    return <EmptyState message="No time logged in this period." height={height} />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -36, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
        <XAxis
          dataKey="category"
          angle={0}
          minTickGap={5}
          tickMargin={8}
          tick={{ fontSize: 14, fill: colors.axis }}
          stroke={colors.grid}
        />
        <YAxis tick={{ fill: colors.axis }} stroke={colors.grid} />
        <Tooltip
          cursor={{ fill: colors.cursor }}
          {...CHART_TOOLTIP_STYLE}
        />
        <Bar dataKey="hours" />
      </BarChart>
    </ResponsiveContainer>
  );
}
