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

type CategoryChartProps = {
  entries: Entry[];
  isDark: boolean;
};

export function CategoryChart({ entries, isDark }: CategoryChartProps) {
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

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: -36, bottom: 4 }}
        >
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
    </div>
  );
}
