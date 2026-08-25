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
import { LIGHT_PALETTE, DARK_PALETTE } from "@/components/entries/colors";
import { EmptyState } from "@/components/entries/EmptyState";

type CategoryChartProps = {
  entries: Entry[];
  isDark: boolean;
  height?: number; // optional, default 300
};

export function CategoryChart({
  entries,
  isDark,
  height = 300,
}: CategoryChartProps) {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const grouped: Record<string, number> = {};
  entries.forEach((entry) => {
    grouped[entry.category] =
      (grouped[entry.category] || 0) + entry.duration_seconds;
  });

  const data = Object.entries(grouped).map(([category, seconds], index) => ({
    category,
    hours: +(seconds / 3600).toFixed(2),
    fill: palette[index % palette.length],
  }));

  if (data.length === 0) {
    return <EmptyState message="No time logged in this period." height={height} />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -36, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="category"
          angle={0}
          minTickGap={5}
          tickMargin={8}
          tick={{ fontSize: 14 }}
        />
        <YAxis />
        <Tooltip
          cursor={{ fill: isDark ? "#262626" : "#e7e5e4" }}
          labelStyle={{ color: isDark ? "#000000" : undefined }} // label text color
        />
        <Bar dataKey="hours" />
      </BarChart>
    </ResponsiveContainer>
  );
}
