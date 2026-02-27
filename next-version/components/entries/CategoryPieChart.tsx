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
import { LIGHT_PALETTE, DARK_PALETTE } from "@/components/entries/colors";
import { ReactNode } from "react";

type CategoryPieChartProps = {
  entries: Entry[];
  isDark: boolean;
  height?: number; // optional, default 300
};

export function CategoryPieChart({
  entries,
  isDark,
  height = 300,
}: CategoryPieChartProps) {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

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
    fill: palette[index % palette.length],
  }));

  const totalHours = data.reduce((sum, d) => sum + d.hours, 0);

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
        fill={isDark ? "#fff" : "#111"}
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
    const label = (item?.payload as any)?.category as string;

    // Recharts expects either ReactNode or [value, name]
    return [`${numeric} h (${pct.toFixed(1)}%)`, label];
  };

  return (
    <div>
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
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ fill: isDark ? "#262626" : "#e7e5e4" }}
            formatter={tooltipFormatter}
            labelStyle={{ color: isDark ? "#000000" : undefined }}
          />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            formatter={(value) => (
              <span style={{ color: isDark ? "#e5e7eb" : "#111827" }}>
                {value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
