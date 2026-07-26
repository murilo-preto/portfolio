"use client";

import { FinanceEntry } from "@/components/finance/types";
import { formatPrice } from "@/components/finance/utils";

type FinanceCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
};

export function Card({ title, value, subtitle }: FinanceCardProps) {
  return (
    <div className="bg-surface p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wide">
        {title}
      </h3>
      <p className="text-2xl md:text-3xl font-bold mt-2">{value}</p>
      {subtitle && (
        <p className="text-xs text-dim mt-1">
          {subtitle}
        </p>
      )}
    </div>
  );
}

type EntriesTableProps = {
  entries: FinanceEntry[];
  showAll?: boolean;
};

export function EntriesTable({ entries, showAll = false }: EntriesTableProps) {
  const displayEntries = showAll ? entries : entries.slice(0, 10);

  return (
    <div className="bg-surface p-4 md:p-6 rounded-xl shadow text-black dark:text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {showAll ? "All Entries" : "Recent Entries"}
        </h2>
        {showAll && (
          <span className="text-xs text-muted">
            {entries.length} entries
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">
          No entries found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-default">
                <th className="pb-3 font-medium">Product</th>
                <th className="pb-3 font-medium">Category</th>
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {displayEntries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-subtle last:border-0"
                >
                  <td className="py-3 font-medium">{entry.product_name}</td>
                  <td className="py-3 text-muted">
                    {entry.category}
                  </td>
                  <td className="py-3 text-muted">
                    {new Date(entry.purchase_date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        entry.status === "done"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono">
                    {formatPrice(entry.price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
