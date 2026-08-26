"use client";

import { useEffect, useRef, useState } from "react";
import { formatPrice } from "@/lib/currency";

type BatchGenerateModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type Category = {
  id: number;
  name: string;
};

type EntryRow = {
  category: string;
  product_name: string;
  price: string;
};

type GenerateRow = {
  purchase_date: string;
  category: string;
  product_name: string;
  price: number;
};

type GeneratePayload = {
  frequency: string;
  day: number;
  start_date: string;
  end_date: string;
  status: "planned" | "done";
  entries: Array<{ category: string; product_name: string; price: number }>;
  preview: boolean;
  utc_offset_minutes: number;
};

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

function defaultStartDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01`;
}

function defaultEndDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-12-31`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function inputClass() {
  return "w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted uppercase tracking-wide">
      {children}
    </label>
  );
}

export function BatchGenerateModal({
  isOpen,
  onClose,
  onSuccess,
}: BatchGenerateModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [frequency, setFrequency] = useState("monthly");
  const [day, setDay] = useState("1");
  const [lastDay, setLastDay] = useState(false);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [status, setStatus] = useState<"planned" | "done">("planned");
  const [rows, setRows] = useState<EntryRow[]>([
    { category: "", product_name: "", price: "" },
  ]);
  const [preview, setPreview] = useState<GenerateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const payloadRef = useRef<GeneratePayload | null>(null);

  useEffect(() => {
    fetch("/api/finance/categories")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCategories(data?.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  if (!isOpen) return null;

  function updateRow(index: number, patch: Partial<EntryRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  }

  function buildPayload(previewFlag: boolean): GeneratePayload | null {
    const entryPayload = rows
      .filter((r) => r.product_name.trim() && r.price !== "")
      .map((r) => ({
        category: r.category,
        product_name: r.product_name.trim(),
        price: parseFloat(r.price),
      }));

    if (entryPayload.length === 0) {
      setError("Add at least one entry with a product name and price.");
      return null;
    }

    const dayValue = lastDay ? -1 : parseInt(day, 10);
    if (!lastDay && (isNaN(dayValue) || dayValue < 1 || dayValue > 31)) {
      setError("Day must be between 1 and 31.");
      return null;
    }

    return {
      frequency,
      day: dayValue,
      start_date: startDate,
      end_date: endDate,
      status,
      entries: entryPayload,
      preview: previewFlag,
      utc_offset_minutes: new Date().getTimezoneOffset(),
    };
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const payload = buildPayload(true);
    if (!payload) return;

    setLoading(true);
    try {
      const res = await fetch("/api/finance/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to preview");
      payloadRef.current = payload;
      setPreview(data.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    if (!payloadRef.current) return;
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/finance/batch-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payloadRef.current, preview: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate entries");
      if (data.failed > 0) {
        throw new Error(
          `${data.failed} of ${data.success + data.failed} entries failed to import`
        );
      }

      setSuccessMsg(`Created ${data.success} entries.`);
      setPreview(null);
      payloadRef.current = null;
      setRows([{ category: "", product_name: "", price: "" }]);

      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate entries");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setError(null);
    setSuccessMsg(null);
    setPreview(null);
    setFrequency("monthly");
    setDay("1");
    setLastDay(false);
    setStartDate(defaultStartDate());
    setEndDate(defaultEndDate());
    setStatus("planned");
    setRows([{ category: "", product_name: "", price: "" }]);
    setLoading(false);
    payloadRef.current = null;
    onClose();
  }

  const totalAmount =
    preview?.reduce((acc, r) => acc + r.price, 0) ?? 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-default p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">Bulk Add Entries</h2>
          <button
            onClick={handleClose}
            className="text-muted hover:text-gray-600 dark:hover:text-gray-200 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handlePreview} className="p-4 md:p-6 space-y-4">
          {/* Schedule */}
          <div className="bg-surface-inset rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-medium text-secondary">Schedule</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Frequency</Label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className={inputClass()}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Day</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={day}
                    disabled={lastDay}
                    onChange={(e) => setDay(e.target.value)}
                    className={inputClass()}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-secondary whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={lastDay}
                      onChange={(e) => setLastDay(e.target.checked)}
                      className="rounded border-strong"
                    />
                    Last day
                  </label>
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "planned" | "done")}
                  className={inputClass()}
                >
                  <option value="planned">Planned</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass()}
                  required
                />
              </div>
              <div>
                <Label>End Date</Label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputClass()}
                  required
                />
              </div>
            </div>
            {lastDay && (
              <p className="text-xs text-muted">
                Entries land on the last day of each period (day 31 becomes the
                30th, February becomes the 28th/29th).
              </p>
            )}
          </div>

          {/* Entry templates */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-secondary">Entries</h3>
              <button
                type="button"
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    { category: "", product_name: "", price: "" },
                  ])
                }
                className="text-xs px-3 py-1.5 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
              >
                + Add another
              </button>
            </div>

            {rows.map((row, index) => (
              <div key={index} className="flex flex-col sm:flex-row gap-2">
                <select
                  value={row.category}
                  onChange={(e) => updateRow(index, { category: e.target.value })}
                  className={inputClass()}
                  required
                >
                  <option value="">— Category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.product_name}
                  onChange={(e) => updateRow(index, { product_name: e.target.value })}
                  placeholder="Product name"
                  className={inputClass()}
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.price}
                  onChange={(e) => updateRow(index, { price: e.target.value })}
                  placeholder="0.00"
                  className={`${inputClass()} sm:max-w-[120px]`}
                  required
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => prev.filter((_, i) => i !== index))
                    }
                    className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Messages */}
          {error && (
            <p className="text-sm text-center text-red-500">{error}</p>
          )}
          {successMsg && (
            <p className="text-sm text-center text-tint-green-ink dark:text-green-400">
              {successMsg}
            </p>
          )}

          {/* Preview */}
          {preview && preview.length > 0 && (
            <div className="border border-default rounded-lg overflow-hidden">
              <div className="bg-surface-inset px-4 py-2 border-b border-default flex items-center justify-between">
                <h3 className="text-sm font-medium text-secondary">
                  Preview ({preview.length} entries ·{" "}
                  <span className="text-primary">{formatPrice(totalAmount)}</span>)
                </h3>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-inset sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-muted border-b border-default">
                        Date
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-muted border-b border-default">
                        Category
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-muted border-b border-default">
                        Product
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-muted border-b border-default">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-b border-subtle">
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {formatDate(row.purchase_date)}
                        </td>
                        <td className="px-4 py-2 text-secondary">
                          {row.category}
                        </td>
                        <td className="px-4 py-2 text-secondary">
                          {row.product_name}
                        </td>
                        <td className="px-4 py-2 text-secondary text-right whitespace-nowrap">
                          {formatPrice(row.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 10 && (
                  <div className="px-4 py-2 text-sm text-muted bg-surface-inset">
                    ... and {preview.length - 10} more entries
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-lg border border-strong bg-surface-raised text-secondary font-medium text-sm hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            {preview && preview.length > 0 ? (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="flex-1 py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? "Creating..." : `Create ${preview.length} Entries`}
              </button>
            ) : (
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? "Previewing..." : "Preview"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
