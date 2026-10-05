"use client";

import {
  ResponsiveContainer,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  // Types
  TooltipProps,
  PieLabelRenderProps,
} from "recharts";
import { Entry } from "@/components/entries/types";
import { CHART_TOOLTIP_STYLE, useChartColors } from "@/lib/use-chart-colors";
import { EmptyState } from "@/components/entries/EmptyState";
import { ReactNode } from "react";

type CategoryPieChartProps = {
  entries: Entry[];
  height?: number; // optional, default 300
};

export function CategoryPieChart({
  entries,
  height = 300,
}: CategoryPieChartProps) {
  const colors = useChartColors();

  // Aggregate duration (seconds) per category
  const grouped: Record<string, number> = {};
  for (const entry of entries) {
    grouped[entry.category] =
      (grouped[entry.category] || 0) + entry.duration_seconds;
  }

  // Prepare chart data: hours + color per slice
  const data = Object.entries(grouped).map(([category, seconds], index) => ({
    category,
    hours: +(seconds / 3600).toFixed(2),
    fill: colors.series[index % colors.series.length],
  }));

  const totalHours = data.reduce((sum, d) => sum + d.hours, 0);

  const isEmpty = data.length === 0;

  // ---- Label renderer (typed) ----
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

    if (!totalHours || numeric <= 0) return null;

    const percent = (numeric / totalHours) * 100;
    if (percent < 3) return null; // avoid clutter for tiny slices

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

  // ---- Tooltip formatter (typed) ----
  const tooltipFormatter: TooltipProps<number, string>["formatter"] = (
    value,
    _name,
    item,
  ) => {
    // value can be number | string | undefined
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : 0;

    const pct = totalHours > 0 ? (numeric / totalHours) * 100 : 0;
    const label = (item?.payload as { category?: string } | undefined)?.category ?? "";

    // Recharts expects either ReactNode or [value, name]
    return [`${numeric} h (${pct.toFixed(1)}%)`, label];
  };

  if (isEmpty) {
    return <EmptyState message="No time logged in this period." height={height} />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="hours"
          nameKey="category"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          labelLine={false}
          label={renderLabel}
          // IMPORTANT: rely on per-item "fill" from data; no <Cell> needed
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
  );
}
