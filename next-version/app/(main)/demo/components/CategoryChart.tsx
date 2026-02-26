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
import { Entry } from "../types";

const LIGHT_PALETTE = ["#a3b18a", "#9EA479", "#899063", "#354024", "#3A3D29"];
const DARK_PALETTE = ["#007ea7"];

type CategoryChartProps = {
  entries: Entry[];
  isDark: boolean;
  showAll: boolean;
};

export function CategoryChart({ entries, isDark, showAll }: CategoryChartProps) {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const grouped: Record<string, number> = {};
  entries.forEach((entry) => {
    grouped[entry.category] = (grouped[entry.category] || 0) + entry.duration_seconds;
  });

  const data = Object.entries(grouped).map(([category, seconds], index) => ({
    category,
    hours: +(seconds / 3600).toFixed(2),
    fill: palette[index % palette.length],
  }));

  return (
    <div className="bg-offwhite dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Hours by Category</h2>
        <span className="text-xs opacity-70">
          Scope: {showAll ? "All entries" : "Selected week"}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: -36, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="category" />
          <YAxis />
          <Tooltip cursor={{ fill: isDark ? "#262626" : "#e7e5e4" }} />
          <Bar dataKey="hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
