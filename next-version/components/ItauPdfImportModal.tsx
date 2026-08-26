"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeCategoryName } from "@/lib/categoryName";
import { formatPrice } from "@/lib/currency";

type ItauPdfImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: () => void;
};

type ParsedEntry = {
  category: string;
  product_name: string;
  price: number;
  /** Bare "YYYY-MM-DD" — the statement carries no time of day. */
  purchase_date: string;
  status: "planned" | "done";
  card: string;
  file: string;
};

type SkippedEntry = ParsedEntry & { reason: string };

type StatementInfo = {
  file: string;
  issued_on: string;
  due_on: string | null;
  cards: string[];
  total: number;
  reconciled: boolean;
  entry_count: number;
  skipped_count: number;
};

type Failure = { file: string; error: string };

type ParseResponse = {
  statements: StatementInfo[];
  failures: Failure[];
  entries: ParsedEntry[];
  skipped: SkippedEntry[];
};

type ImportResult = {
  success: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
};

type Status = "idle" | "parsing" | "ready" | "importing" | "success" | "error";

/** Rows rendered in the preview before it collapses into a "and N more" line. */
const PREVIEW_LIMIT = 100;

/** Sentinel option value that opens the "new category" input. */
const NEW_CATEGORY = "__new__";

/**
 * The import matches categories case-insensitively, so a parsed "Alimentação"
 * lands on an existing "ALIMENTAÇÃO" row and is stored under that spelling.
 * Adopt the existing spelling up front so the preview shows what will actually
 * be saved instead of silently disagreeing with it.
 */
function adoptExistingSpellings<T extends { category: string }>(
  rows: T[],
  known: string[]
): T[] {
  if (known.length === 0) return rows;

  const canonical = new Map(known.map((name) => [name.toLowerCase(), name]));
  let changed = false;

  const next = rows.map((row) => {
    const match = canonical.get(row.category.toLowerCase());
    if (match && match !== row.category) {
      changed = true;
      return { ...row, category: match };
    }
    return row;
  });

  return changed ? next : rows;
}

export function ItauPdfImportModal({
  isOpen,
  onClose,
  onImportSuccess,
}: ItauPdfImportModalProps) {
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [skipped, setSkipped] = useState<SkippedEntry[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  // Preview row whose cell is showing the "new category" input, and what has
  // been typed into it.
  const [creatingFor, setCreatingFor] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filenames are long and unhelpful in a dense table; the issue date is what
  // actually distinguishes one statement from another.
  const issuedByFile = useMemo(() => {
    const map = new Map<string, string>();
    for (const statement of statements) {
      map.set(statement.file, statement.issued_on);
    }
    return map;
  }, [statements]);

  // Options offered when reassigning a row: the categories that already exist,
  // plus the ones read off the statements, which may not exist yet.
  const categoryOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const name of knownCategories) {
      bySlug.set(name.toLowerCase(), name);
    }
    const isNew = new Set<string>();
    for (const entry of entries) {
      const slug = entry.category.toLowerCase();
      if (!bySlug.has(slug)) {
        bySlug.set(slug, entry.category);
        isNew.add(slug);
      }
    }
    return [...bySlug.entries()]
      .map(([slug, name]) => ({ name, isNew: isNew.has(slug) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [knownCategories, entries]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/finance/categories", {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setKnownCategories(
          (data.categories ?? []).map((c: { name: string }) => c.name)
        );
      } catch {
        // Non-fatal: without the list you can still import the categories the
        // statements came with, you just cannot reassign rows to other ones.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Covers categories arriving after a parse; handleFileChange covers the
  // usual order, where they are already loaded when files are picked.
  // Adjusting during render avoids a cascading extra render from an effect.
  const [prevKnownCategories, setPrevKnownCategories] = useState(knownCategories);
  if (prevKnownCategories !== knownCategories) {
    setPrevKnownCategories(knownCategories);
    setEntries((prev) => adoptExistingSpellings(prev, knownCategories));
  }

  if (!isOpen) return null;

  const grandTotal = entries.reduce((sum, entry) => sum + entry.price, 0);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    setStatus("parsing");
    setMessage(
      selected.length === 1
        ? "Reading statement..."
        : `Reading ${selected.length} statements...`
    );
    setResult(null);
    setStatements([]);
    setFailures([]);
    setEntries([]);
    setSkipped([]);

    try {
      const formData = new FormData();
      for (const file of selected) {
        formData.append("file", file);
      }

      const response = await fetch("/api/finance/parse-itau-pdf", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to read the statements");
      }

      const parsed = data as ParseResponse;
      setStatements(parsed.statements);
      setFailures(parsed.failures);
      setEntries(adoptExistingSpellings(parsed.entries, knownCategories));
      setSkipped(parsed.skipped);
      setStatus("ready");
      setMessage(
        parsed.entries.length === 0
          ? "No transactions found"
          : `Found ${parsed.entries.length} transactions across ` +
            `${parsed.statements.length} statement` +
            `${parsed.statements.length === 1 ? "" : "s"}`
      );
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to read the statements"
      );
    }
  }

  async function handleImport() {
    if (entries.length === 0) return;

    setStatus("importing");
    setMessage("Importing...");

    try {
      const payload = {
        entries: entries.map((entry) => ({
          category: entry.category,
          product_name: entry.product_name,
          price: entry.price,
          // Anchor the statement's calendar date to midnight in the browser's
          // timezone, the same way the CSV import does.
          purchase_date: new Date(`${entry.purchase_date}T00:00:00`).toISOString(),
          status: entry.status,
        })),
      };

      const response = await fetch("/api/finance/batch-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data: ImportResult = await response.json();

      if (!response.ok) {
        throw new Error(data.errors?.[0]?.error || "Import failed");
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

  function setEntryCategory(index: number, category: string) {
    setEntries((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, category } : entry))
    );
  }

  function createAndAssign(index: number) {
    const name = normalizeCategoryName(draftName);
    if (!name) return;
    // No API call needed: the import creates any category it does not find.
    setEntryCategory(index, name);
    setCreatingFor(null);
    setDraftName("");
  }

  function resetState() {
    setStatements([]);
    setFailures([]);
    setEntries([]);
    setSkipped([]);
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

  const unreconciled = statements.filter((s) => !s.reconciled);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-default p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">
            Import Itaú PDF Bank Statements
          </h2>
          <button
            onClick={handleClose}
            className="text-muted hover:text-gray-600 dark:hover:text-gray-200 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 md:p-6 space-y-4">
          {/* Instructions */}
          <div className="bg-surface-inset rounded-lg p-4">
            <h3 className="text-sm font-medium text-secondary mb-2">
              How to import
            </h3>
            <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
              <li>Download your credit card statement PDFs from the Itaú app</li>
              <li>
                Select one or more of them below — pick several at once to
                import months in a single go
              </li>
              <li>Review the preview and click Import</li>
            </ol>
          </div>

          {/* File picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={handleFileChange}
            className="block w-full text-sm text-muted
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-neutral-800 file:text-white
              dark:file:bg-neutral-100 dark:file:text-neutral-900
              hover:file:opacity-90 cursor-pointer"
          />

          {/* Status Message */}
          {message && (
            <p
              className={`text-sm text-center ${
                status === "success"
                  ? "text-tint-green-ink dark:text-green-400"
                  : status === "error"
                  ? "text-red-500"
                  : "text-muted"
              }`}
            >
              {message}
            </p>
          )}

          {/* Per-statement summary */}
          {statements.length > 0 && (
            <div className="border border-default rounded-lg overflow-hidden">
              <div className="bg-surface-inset px-4 py-2 border-b border-default">
                <h3 className="text-sm font-medium text-secondary">
                  Statements ({statements.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-inset">
                    <tr>
                      {["Issued", "Due", "Cards", "Transactions", "Total"].map(
                        (col) => (
                          <th
                            key={col}
                            className="px-4 py-2 text-left font-medium text-muted border-b border-default whitespace-nowrap"
                          >
                            {col}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((statement) => (
                      <tr key={statement.file} className="border-b border-subtle">
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {statement.issued_on}
                          {!statement.reconciled && (
                            <span
                              title="Transactions do not add up to the printed totals"
                              className="ml-2 text-amber-600 dark:text-amber-400"
                            >
                              ⚠
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {statement.due_on ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {statement.cards.map((c) => `••••${c}`).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {statement.entry_count}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {formatPrice(statement.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-inset font-medium">
                      <td
                        className="px-4 py-2 text-secondary whitespace-nowrap"
                        colSpan={3}
                      >
                        To import
                      </td>
                      <td className="px-4 py-2 text-primary whitespace-nowrap">
                        {entries.length}
                      </td>
                      <td className="px-4 py-2 text-primary whitespace-nowrap">
                        {formatPrice(grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Files that could not be read */}
          {failures.length > 0 && (
            <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
              <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-200 dark:border-red-800">
                <h3 className="text-sm font-medium text-red-700 dark:text-red-400">
                  Not imported ({failures.length})
                </h3>
              </div>
              <div className="max-h-40 overflow-y-auto p-4 space-y-1">
                {failures.map((failure) => (
                  <div
                    key={failure.file}
                    className="text-sm text-red-600 dark:text-red-400"
                  >
                    <span className="font-mono">{failure.file}</span>:{" "}
                    {failure.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reconciliation warning */}
          {unreconciled.length > 0 && (
            <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-300">
              The transactions read from{" "}
              {unreconciled.length === 1
                ? `the statement issued ${unreconciled[0].issued_on}`
                : `${unreconciled.length} statements (${unreconciled
                    .map((s) => s.issued_on)
                    .join(", ")})`}{" "}
              do not add up to the totals printed on them. Some lines may be
              missing or wrong — review the preview carefully before importing.
            </div>
          )}

          {/* Skipped credits/refunds */}
          {skipped.length > 0 && (
            <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-300">
              {skipped.length} credit/refund line
              {skipped.length === 1 ? "" : "s"} will not be imported — finance
              entries cannot hold a negative amount (
              {skipped.map((s) => s.product_name).join(", ")}).
            </div>
          )}

          {/* Preview Table */}
          {entries.length > 0 && status !== "importing" && (
            <div className="border border-default rounded-lg overflow-hidden">
              <div className="bg-surface-inset px-4 py-2 border-b border-default flex items-baseline justify-between gap-4">
                <h3 className="text-sm font-medium text-secondary">
                  Preview ({entries.length} entries)
                </h3>
                <span className="text-xs text-dim">
                  Click a row&apos;s category to reassign it
                </span>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-inset sticky top-0">
                    <tr>
                      {["Date", "Product", "Category", "Card", "Price"]
                        .concat(statements.length > 1 ? ["Statement"] : [])
                        .map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2 text-left font-medium text-muted border-b border-default"
                          >
                            {col}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.slice(0, PREVIEW_LIMIT).map((entry, idx) => (
                      <tr key={idx} className="border-b border-subtle">
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {entry.purchase_date}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {entry.product_name}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {creatingFor === idx ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={draftName}
                                placeholder="New category"
                                onChange={(e) => setDraftName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") createAndAssign(idx);
                                  if (e.key === "Escape") setCreatingFor(null);
                                }}
                                className="w-32 rounded-md border border-strong bg-surface-raised px-2 py-1 text-sm text-primary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => createAndAssign(idx)}
                                disabled={!draftName.trim()}
                                className="rounded-md border border-strong px-2 py-1 text-xs hover:bg-surface-hover disabled:opacity-50 transition-colors"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            /* Always a select, styled flat until hovered, so a
                               single click opens the list. */
                            <select
                              aria-label={`Category for ${entry.product_name}`}
                              value={entry.category}
                              onChange={(e) => {
                                if (e.target.value === NEW_CATEGORY) {
                                  setDraftName("");
                                  setCreatingFor(idx);
                                } else {
                                  setEntryCategory(idx, e.target.value);
                                }
                              }}
                              className="w-full max-w-[16rem] cursor-pointer rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-secondary hover:border-strong hover:bg-surface-raised focus:border-strong focus:bg-surface-raised focus:outline-none transition-colors"
                            >
                              {categoryOptions.map((option) => (
                                <option key={option.name} value={option.name}>
                                  {option.name}
                                  {option.isNew ? " (new)" : ""}
                                </option>
                              ))}
                              <option value={NEW_CATEGORY}>
                                + New category…
                              </option>
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {entry.card ? `••••${entry.card}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-secondary whitespace-nowrap">
                          {formatPrice(entry.price)}
                        </td>
                        {statements.length > 1 && (
                          <td className="px-4 py-2 text-dim whitespace-nowrap">
                            {issuedByFile.get(entry.file) ?? entry.file}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {entries.length > PREVIEW_LIMIT && (
                  <div className="px-4 py-2 text-sm text-muted bg-surface-inset">
                    ... and {entries.length - PREVIEW_LIMIT} more entries
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
                  <div key={idx} className="text-sm text-red-600 dark:text-red-400">
                    <span className="font-mono">Row {err.index + 1}:</span> {err.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {status === "ready" && entries.length > 0 && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-lg border border-strong bg-surface-raised text-secondary font-medium text-sm hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="flex-1 py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm hover:opacity-90 transition-opacity"
              >
                Import {entries.length} Entries
              </button>
            </div>
          )}

          {/* Close Button for Success/Error */}
          {(status === "success" || (status === "error" && result)) && (
            <button
              onClick={handleClose}
              className="w-full py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm hover:opacity-90 transition-opacity"
            >
              {status === "success" ? "Done" : "Close"}
            </button>
          )}

          {/* Empty State */}
          {status === "idle" && (
            <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-default text-sm text-dim">
              Select one or more Itaú statement PDFs to preview transactions
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
