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
import { useCurrency } from "@/lib/use-currency";
import { CHART_TOOLTIP_STYLE, useChartColors } from "@/lib/use-chart-colors";

type CategoryChartProps = {
  entries: FinanceEntry[];
};

export function CategoryChart({ entries }: CategoryChartProps) {
  const { formatPrice } = useCurrency();
  const colors = useChartColors();

  const grouped: Record<string, number> = {};
  entries.forEach((entry) => {
    grouped[entry.category] = (grouped[entry.category] || 0) + entry.price;
  });

  const data = Object.entries(grouped).map(([category, price], index) => ({
    category,
    price: +price.toFixed(2),
    fill: colors.series[index % colors.series.length],
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: -36, bottom: 4 }}
        >
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
            formatter={(value) => [formatPrice(Number(value)), "Amount"]}
          />
          <Bar dataKey="price" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
