"use client";

import { useState, useRef } from "react";

type BatchImportType = "time" | "finance" | "recurring";

type BatchImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  importType: BatchImportType;
  onImportSuccess: () => void;
};

type ParsedEntry = Record<string, unknown>;

type ImportResult = {
  success: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
};

export function BatchImportModal({
  isOpen,
  onClose,
  importType,
  onImportSuccess,
}: BatchImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "parsing" | "ready" | "importing" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const config = getConfig(importType);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setStatus("parsing");
    setMessage(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const rows = parseCSV(text);
        const parsed = parseDataWithHeaders(rows, importType);
        setPreview(parsed);
        setStatus("ready");
        setMessage(`Parsed ${parsed.length} entries`);
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to parse CSV");
      }
    };
    reader.readAsText(selectedFile);
  }

  async function handleImport() {
    if (preview.length === 0) return;

    setStatus("importing");
    setMessage("Importing...");

    try {
      const payload = importType === "time" 
        ? { entries: preview }
        : importType === "finance"
        ? { entries: preview }
        : { expenses: preview };

      const endpoint = importType === "time"
        ? "/api/entry/batch-import"
        : importType === "finance"
        ? "/api/finance/batch-import"
        : "/api/recurring-expenses/batch-import";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data: ImportResult = await response.json();

      if (!response.ok) {
        throw new Error(data.errors[0]?.error || "Import failed");
      }

      setResult(data);
      setStatus(data.failed > 0 ? "error" : "success");
      setMessage(
        data.failed > 0
          ? `Imported ${data.success} entries. ${data.failed} failed.`
          : `Successfully imported ${data.success} entries!`
      );

      if (data.failed === 0) {
        setTimeout(() => {
          resetState();
          onImportSuccess();
          onClose();
        }, 2000);
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Import failed");
    }
  }

  function handleDownloadTemplate() {
    const template = getTemplate(importType);
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${importType}_template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetState() {
    setFile(null);
    setPreview([]);
    setStatus("idle");
    setMessage(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleClose() {
    resetState();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-700 p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Batch Import {config.title}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 md:p-6 space-y-4">
          {/* Instructions */}
          <div className="bg-gray-50 dark:bg-neutral-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              How to import
            </h3>
            <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
              <li>Download the CSV template below</li>
              <li>Fill in your data following the format</li>
              <li>Upload the CSV file</li>
              <li>Review the preview and click Import</li>
            </ol>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
            >
              📥 Download Template
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block flex-1 text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-lg file:border-0
                file:text-sm file:font-medium
                file:bg-neutral-800 file:text-white
                dark:file:bg-neutral-100 dark:file:text-neutral-900
                hover:file:opacity-90 cursor-pointer"
            />
          </div>

          {/* Status Message */}
          {message && (
            <p
              className={`text-sm text-center ${
                status === "success"
                  ? "text-green-600 dark:text-green-400"
                  : status === "error"
                  ? "text-red-500"
                  : "text-gray-600 dark:text-gray-400"
              }`}
            >
              {message}
            </p>
          )}

          {/* Preview Table */}
          {preview.length > 0 && status !== "importing" && (
            <div className="border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden">
              <div className="bg-gray-50 dark:bg-neutral-800 px-4 py-2 border-b border-gray-200 dark:border-neutral-700">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Preview ({preview.length} entries)
                </h3>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-neutral-800 sticky top-0">
                    <tr>
                      {config.columns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-neutral-700"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 10).map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-gray-100 dark:border-neutral-800"
                      >
                        {config.columns.map((col) => (
                          <td
                            key={col}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap"
                          >
                            {String(row[col.toLowerCase()] || "-")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 10 && (
                  <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-neutral-800">
                    ... and {preview.length - 10} more entries
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error Details */}
          {result && result.errors.length > 0 && (
            <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
              <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-200 dark:border-red-800">
                <h3 className="text-sm font-medium text-red-700 dark:text-red-400">
                  Errors ({result.errors.length})
                </h3>
              </div>
              <div className="max-h-48 overflow-y-auto p-4 space-y-1">
                {result.errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    <span className="font-mono">Row {err.index + 1}:</span> {err.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {status === "ready" && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-700 dark:text-gray-300 font-medium text-sm hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="flex-1 py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm hover:opacity-90 transition-opacity"
              >
                Import {preview.length} Entries
              </button>
            </div>
          )}

          {/* Close Button for Success/Error */}
          {(status === "success" || (status === "error" && result)) && (
            <button
              onClick={handleClose}
              className="w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm hover:opacity-90 transition-opacity"
            >
              {status === "success" ? "Done" : "Close"}
            </button>
          )}

          {/* Empty State */}
          {status === "idle" && preview.length === 0 && (
            <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
              Upload a CSV file to preview entries
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(csv: string): string[][] {
  const lines = csv.trim().split("\n");
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(line.split(",").map((p) => p.trim()));
  }
  return rows;
}

function parseDataWithHeaders(rows: string[][], type: BatchImportType): ParsedEntry[] {
  if (rows.length < 2) return [];
  
  // First row is header - create column name to index mapping
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const colIndex: Record<string, number> = {};
  headers.forEach((header, idx) => {
    colIndex[header] = idx;
  });
  
  const entries: ParsedEntry[] = [];
  
  // Process data rows (skip header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    try {
      if (type === "time") {
        const category = row[colIndex["category"]];
        const start_date = row[colIndex["start_date"]];
        const start_time = row[colIndex["start_time"]];
        const end_date = row[colIndex["end_date"]];
        const end_time = row[colIndex["end_time"]];
        
        if (!category || !start_date || !start_time || !end_date || !end_time) continue;
        
        const startISO = parseDateTime(start_date, start_time);
        const endISO = parseDateTime(end_date, end_time);
        if (startISO && endISO) {
          entries.push({ category, start_time: startISO, end_time: endISO });
        }
      } else if (type === "finance") {
        const category = row[colIndex["category"]];
        const product_name = row[colIndex["product_name"]];
        const price = row[colIndex["price"]];
        const purchase_date = row[colIndex["purchase_date"]];
        const status = row[colIndex["status"]] || "planned";
        
        if (!category || !product_name || !price || !purchase_date) continue;
        
        const priceValue = parseFloat(price);
        if (!isNaN(priceValue) && priceValue >= 0) {
          entries.push({
            category,
            product_name,
            price: priceValue,
            purchase_date: new Date(purchase_date).toISOString(),
            status: status.toLowerCase(),
          });
        }
      } else if (type === "recurring") {
        const category = row[colIndex["category"]];
        const name = row[colIndex["name"]];
        const amount = row[colIndex["amount"]];
        const frequency = row[colIndex["frequency"]] || "monthly";
        const start_date = row[colIndex["start_date"]];
        const end_date = row[colIndex["end_date"]];
        const next_payment_date = row[colIndex["next_payment_date"]];
        const is_active = row[colIndex["is_active"]];
        
        if (!category || !name || !amount || !frequency || !start_date) continue;
        
        const amountValue = parseFloat(amount);
        if (!isNaN(amountValue) && amountValue >= 0) {
          entries.push({
            category,
            name,
            amount: amountValue,
            frequency: frequency.toLowerCase(),
            start_date,
            end_date: end_date || undefined,
            next_payment_date: next_payment_date || undefined,
            is_active: is_active ? is_active.toLowerCase() === "true" : true,
          });
        }
      }
    } catch (err) {
      console.error(`Error parsing row ${i}:`, err);
    }
  }
  
  return entries;
}

function parseDateTime(date: string, time: string): string | null {
  const dateParts = date.trim().split("/");
  if (dateParts.length !== 3) return null;
  const [month, day, year] = dateParts;
  const [hour, minute] = time.trim().split(":");
  const d = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute)
  );
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getConfig(type: BatchImportType): { title: string; columns: string[] } {
  switch (type) {
    case "time":
      return { title: "Time Entries", columns: ["Category", "Start Time", "End Time"] };
    case "finance":
      return { title: "Finance Entries", columns: ["Category", "Product", "Price", "Date", "Status"] };
    case "recurring":
      return { title: "Recurring Expenses", columns: ["Category", "Name", "Amount", "Frequency", "Start Date"] };
  }
}

function getTemplate(type: BatchImportType): string {
  switch (type) {
    case "time":
      return `category,start_date,start_time,end_date,end_time
Work,01/15/2024,09:00,01/15/2024,10:30
Study,01/16/2024,14:00,01/16/2024,15:30`;
    case "finance":
      return `category,product_name,price,purchase_date,status
Food,Groceries,85.50,2024-01-15 10:30:00,done
Entertainment,Netflix,15.99,2024-01-16 00:00:00,planned`;
    case "recurring":
      return `category,name,amount,frequency,start_date,end_date,next_payment_date,is_active
Subscriptions,Netflix,15.99,monthly,2024-01-01,,2024-02-01,true
Utilities,Electric,120.00,monthly,2024-01-01,2024-12-31,,true`;
  }
}
