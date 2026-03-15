"use client";

import { getPriorityColor } from "./utils";

type PriorityBadgeProps = {
  priority: "low" | "medium" | "high";
};

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const colorClass = getPriorityColor(priority);

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {priority}
    </span>
  );
}
