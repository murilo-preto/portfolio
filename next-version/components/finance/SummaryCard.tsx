"use client";

import { ReactNode } from "react";

type SummaryCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  accentColor?: "blue" | "green" | "amber" | "purple";
};

const accentStyles = {
  blue: "from-tint-blue-a to-tint-blue-b border-tint-blue-line",
  green: "from-tint-green-a to-tint-green-b border-tint-green-line",
  amber: "from-tint-amber-a to-tint-amber-b border-tint-amber-line",
  purple: "from-tint-purple-a to-tint-purple-b border-tint-purple-line",
};

const iconBgStyles = {
  blue: "bg-tint-blue-a text-tint-blue-ink dark:text-blue-400",
  green: "bg-tint-green-a text-tint-green-ink dark:text-green-400",
  amber: "bg-tint-amber-a text-tint-amber-ink dark:text-amber-400",
  purple: "bg-tint-purple-a text-tint-purple-ink dark:text-purple-400",
};

export function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  accentColor = "blue",
}: SummaryCardProps) {
  return (
    <div
      className={`relative overflow-hidden p-4 md:p-5 rounded-xl shadow-sm border bg-surface-raised bg-gradient-to-br ${accentStyles[accentColor]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
            {title}
          </h3>
          <p className="text-xl md:text-2xl font-bold mt-2 text-primary truncate">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-dim mt-1 truncate">
              {subtitle}
            </p>
          )}
        </div>
        <div
          className={`p-2.5 rounded-lg ${iconBgStyles[accentColor]} flex-shrink-0 ml-3`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
