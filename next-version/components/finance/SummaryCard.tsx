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
  blue: "from-blue-500/10 to-blue-600/5 border-blue-500/20",
  green: "from-green-500/10 to-green-600/5 border-green-500/20",
  amber: "from-amber-500/10 to-amber-600/5 border-amber-500/20",
  purple: "from-purple-500/10 to-purple-600/5 border-purple-500/20",
};

const iconBgStyles = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
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
      className={`relative overflow-hidden p-4 md:p-5 rounded-xl shadow-sm border bg-white dark:bg-neutral-900 border-gray-200 dark:border-neutral-800 bg-gradient-to-br ${accentStyles[accentColor]}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            {title}
          </h3>
          <p className="text-2xl md:text-3xl font-bold mt-2 text-gray-900 dark:text-gray-100 truncate">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
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
