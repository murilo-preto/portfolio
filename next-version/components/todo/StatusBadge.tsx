"use client";

import { getStatusColor } from "./utils";

type StatusBadgeProps = {
  status: "pending" | "in_progress" | "completed";
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = getStatusColor(status);

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      {status.replace("_", " ")}
    </span>
  );
}
