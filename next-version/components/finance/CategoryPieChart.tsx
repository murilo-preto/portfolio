"use client";

import {
  ResponsiveContainer,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  TooltipProps,
  PieLabelRenderProps,
} from "recharts";
import { FinanceEntry } from "@/components/finance/types";
import { useCurrency } from "@/lib/use-currency";
import { CHART_TOOLTIP_STYLE, useChartColors } from "@/lib/use-chart-colors";
import { ReactNode } from "react";

type CategoryPieChartProps = {
  entries: FinanceEntry[];
  height?: number;
};

export function CategoryPieChart({
  entries,
  height = 300,
}: CategoryPieChartProps) {
  const { formatPrice } = useCurrency();
  const colors = useChartColors();

  const grouped: Record<string, number> = {};
  for (const entry of entries) {
    grouped[entry.category] = (grouped[entry.category] || 0) + entry.price;
  }

  const data = Object.entries(grouped).map(([category, price], index) => ({
    category,
    price: +price.toFixed(2),
    fill: colors.series[index % colors.series.length],
  }));

  const totalPrice = data.reduce((sum, d) => sum + d.price, 0);

  const renderLabel = ({
    value,
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
  }: PieLabelRenderProps): ReactNode => {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : 0;

    if (!totalPrice || numeric <= 0) return null;

    const percent = (numeric / totalPrice) * 100;
    if (percent < 3) return null;

    const RADIAN = Math.PI / 180;
    const radius =
      (innerRadius ?? 0) + ((outerRadius ?? 0) - (innerRadius ?? 0)) * 0.55;
    const x = (cx ?? 0) + radius * Math.cos(-(midAngle ?? 0) * RADIAN);
    const y = (cy ?? 0) + radius * Math.sin(-(midAngle ?? 0) * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill={colors.on}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: 12, fontWeight: 600 }}
      >
        {`${percent.toFixed(0)}%`}
      </text>
    );
  };

  const tooltipFormatter: TooltipProps<number, string>["formatter"] = (
    value,
    _name,
    item,
  ) => {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : 0;

    const pct = totalPrice > 0 ? (numeric / totalPrice) * 100 : 0;
    const label = (item?.payload as { category?: string } | undefined)?.category ?? "";

    return [`${formatPrice(numeric)} (${pct.toFixed(1)}%)`, label];
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="price"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            labelLine={false}
            label={renderLabel}
            stroke={colors.separator}
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ fill: colors.cursor }}
            {...CHART_TOOLTIP_STYLE}
            formatter={tooltipFormatter}
          />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            formatter={(value) => (
              <span style={{ color: "var(--text-primary)" }}>
                {value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
