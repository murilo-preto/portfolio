"use client";

import { useState } from "react";
import { Entry } from "@/components/entries/types";
import { formatDuration } from "@/components/entries/utils";
import { Panel } from "@/components/entries/Panel";
import { EmptyState } from "@/components/entries/EmptyState";

type EntriesTableProps = {
  entries: Entry[];
  /** Rows rendered before the "show all" affordance appears. */
  initialLimit?: number;
};

const formatStamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { hour12: false });

export function EntriesTable({ entries, initialLimit = 25 }: EntriesTableProps) {
  const [expanded, setExpanded] = useState(false);

  const isTruncated = !expanded && entries.length > initialLimit;
  const visible = isTruncated ? entries.slice(0, initialLimit) : entries;

  return (
    <Panel
      emphasis="flush"
      title="Detailed Entries"
      action={
        entries.length > 0 ? (
          <span className="text-xs text-muted tabular-nums">
            {isTruncated
              ? `${visible.length} of ${entries.length}`
              : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
          </span>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <EmptyState message="No entries in this period." height={120} />
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {visible.map((entry) => (
              <div
                key={entry.id}
                className="border border-subtle rounded-lg p-3 space-y-1"
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="font-medium text-primary">{entry.category}</span>
                  <span className="text-sm font-semibold text-secondary tabular-nums">
                    {formatDuration(entry.duration_seconds)}
                  </span>
                </div>
                <div className="text-xs text-muted space-y-0.5 tabular-nums">
                  <p>Start: {formatStamp(entry.start_time)}</p>
                  <p>End: {formatStamp(entry.end_time)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-default text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 text-left font-medium">Category</th>
                  <th className="py-2 pr-4 text-left font-medium">Start</th>
                  <th className="py-2 pr-4 text-left font-medium">End</th>
                  <th className="py-2 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-subtle hover:bg-surface-hover transition-colors"
                  >
                    <td className="py-2 pr-4 text-left font-medium text-primary">
                      {entry.category}
                    </td>
                    <td className="py-2 pr-4 text-left text-secondary tabular-nums">
                      {formatStamp(entry.start_time)}
                    </td>
                    <td className="py-2 pr-4 text-left text-secondary tabular-nums">
                      {formatStamp(entry.end_time)}
                    </td>
                    <td className="py-2 text-right font-semibold text-primary tabular-nums">
                      {formatDuration(entry.duration_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isTruncated && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-4 w-full py-2 text-sm font-medium rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors text-secondary"
            >
              Show all {entries.length} entries
            </button>
          )}
        </>
      )}
    </Panel>
  );
}
