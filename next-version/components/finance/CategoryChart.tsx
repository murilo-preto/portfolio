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
import { FinanceEntry } from "@/components/finance/types";
import { LIGHT_PALETTE, DARK_PALETTE } from "@/components/entries/colors";

type CategoryChartProps = {
  entries: FinanceEntry[];
  isDark: boolean;
};

export function CategoryChart({ entries, isDark }: CategoryChartProps) {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const grouped: Record<string, number> = {};
  entries.forEach((entry) => {
    grouped[entry.category] = (grouped[entry.category] || 0) + entry.price;
  });

  const data = Object.entries(grouped).map(([category, price], index) => ({
    category,
    price: +price.toFixed(2),
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
            labelStyle={{ color: isDark ? "#000000" : undefined }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Amount"]}
          />
          <Bar dataKey="price" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
