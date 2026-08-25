"use client";

import { useEffect, useState } from "react";
import { BatchImportModal } from "@/components/BatchImportModal";
import { BatchGenerateModal } from "@/components/BatchGenerateModal";
import { ItauPdfImportModal } from "@/components/ItauPdfImportModal";
import { ImportMenu } from "@/components/ImportMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { warmFetch } from "@/lib/prefetch";

// ─── Types ───────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "error";

type FinanceEntry = {
  id: number;
  category: string;
  product_name: string;
  price: number;
  purchase_date: string;
  status: "planned" | "done";
};

type Category = {
  id: number;
  name: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(price);
}

// ─── Shared UI Primitives ────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-muted uppercase tracking-wide">
      {children}
    </label>
  );
}

function StatusMessage({
  status,
  message,
}: {
  status: Status;
  message: string | null;
}) {
  if (!message) return null;
  return (
    <p
      className={`text-sm text-center ${status === "success" ? "text-tint-green-ink dark:text-green-400" : "text-red-500"}`}
    >
      {message}
    </p>
  );
}

function inputClass() {
  return "w-full px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";
}

function PanelCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
    >
      ✕
    </button>
  );
}

function CategorySelect({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: Category[];
}) {
  return (
    <div className="space-y-1">
      <Label>Category</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass()}
      >
        <option value="">— Select category —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: "planned" | "done";
  onChange: (v: "planned" | "done") => void;
}) {
  return (
    <div className="space-y-1">
      <Label>Status</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "planned" | "done")}
        className={inputClass()}
      >
        <option value="planned">Planned</option>
        <option value="done">Done</option>
      </select>
    </div>
  );
}

// ─── Category Panel ──────────────────────────────────────────────────────────

function CategoryPanel({
  categories,
  onClose,
}: {
  categories: Category[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setStatus("loading");
    setMsg(null);

    try {
      const res = await fetch("/api/finance/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create category");

      setStatus("success");
      setMsg(
        res.status === 200
          ? `"${name.trim()}" already exists.`
          : `Category "${name.trim()}" created!`,
      );
      setName("");
    } catch (err) {
      setStatus("error");
      setMsg(err instanceof Error ? err.message : "Failed to create category");
    }
  }

  return (
    <div className="bg-surface border border-default rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-secondary uppercase tracking-wide">
          Create Category
        </h2>
        <PanelCloseButton onClick={onClose} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Category name…"
          className="flex-1 px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
        <button
          onClick={handleCreate}
          disabled={status === "loading" || !name.trim()}
          className="px-4 py-2 rounded-lg bg-invert text-invert-fg text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {status === "loading" ? "…" : "Create"}
        </button>
      </div>

      <StatusMessage status={status} message={msg} />

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {categories.map((c) => (
            <span
              key={c.id}
              className="px-2 py-0.5 rounded-full text-xs bg-surface-hover text-secondary"
            >
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Entry List ──────────────────────────────────────────────────────────────

function EntryList({
  entries,
  loading,
  error,
  selectedId,
  onSelect,
  checkedIds,
  onToggle,
  onToggleAll,
  onDeleteChecked,
  deleting,
}: {
  entries: FinanceEntry[];
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  onSelect: (entry: FinanceEntry) => void;
  checkedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  onDeleteChecked: () => void;
  deleting: boolean;
}) {
  const allChecked = entries.length > 0 && checkedIds.size === entries.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wide">
          {loading ? "Loading…" : `${entries.length} Entries`}
        </h2>
        {entries.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                aria-label="Select all entries"
                checked={allChecked}
                onChange={onToggleAll}
                className="cursor-pointer accent-current"
              />
              Select all
            </label>
            {checkedIds.size > 0 && (
              <button
                type="button"
                onClick={onDeleteChecked}
                disabled={deleting}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
              >
                {deleting ? "Deleting…" : `Delete ${checkedIds.size}`}
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-muted py-4 text-center">
          No finance entries found.
        </p>
      )}

      <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1 [-ms-overflow-style:none_] [scrollbar-width:none]">
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        {entries.map((entry) => {
          const isSelected = entry.id === selectedId;
          return (
            // The checkbox sits alongside the button rather than inside it —
            // nesting one interactive element in another is invalid and would
            // make selecting a row also open it for editing.
            <div key={entry.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Select ${entry.product_name}`}
                checked={checkedIds.has(entry.id)}
                onChange={() => onToggle(entry.id)}
                className="cursor-pointer accent-current shrink-0"
              />
            <button
              onClick={() => onSelect(entry)}
              className={`flex-1 min-w-0 text-left px-4 py-3 rounded-xl border transition-all ${
                isSelected
                  ? "border-neutral-800 dark:border-neutral-300 bg-invert text-invert-fg"
                  : "border-default bg-surface hover:border-gray-400 dark:hover:border-neutral-500"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate flex-1">
                  {entry.product_name}
                </span>
                <span
                  className={`text-xs font-mono shrink-0 ${
                    isSelected
                      ? "text-gray-300 dark:text-neutral-600"
                      : "text-dim"
                  }`}
                >
                  {formatPrice(entry.price)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span
                  className={`text-xs ${
                    isSelected
                      ? "text-gray-300 dark:text-neutral-500"
                      : "text-dim"
                  }`}
                >
                  {entry.category} • {formatDate(entry.purchase_date)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    entry.status === "done"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}
                >
                  {entry.status}
                </span>
              </div>
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Create Entry Panel ───────────────────────────────────────────────────────

function CreateEntryPanel({
  categories,
  onClose,
  onCreated,
}: {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [status, setStatus] = useState<"planned" | "done">("planned");
  const [entryStatus, setEntryStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleCreate() {
    if (!productName || !category || !price || !purchaseDate) return;
    setEntryStatus("loading");
    setMsg(null);

    const date = new Date(purchaseDate);

    if (isNaN(date.getTime())) {
      setEntryStatus("error");
      setMsg("Invalid date values.");
      return;
    }

    try {
      const tokenRes = await fetch("/api/token", { credentials: "include" });
      if (!tokenRes.ok) throw new Error("Not authenticated. Please log in.");

      const res = await fetch("/api/finance/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          price: parseFloat(price),
          purchase_date: date.toISOString(),
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create entry");

      setEntryStatus("success");
      setMsg("Entry created!");
      setProductName("");
      setCategory("");
      setPrice("");
      setPurchaseDate("");
      setStatus("planned");
      onCreated();
    } catch (err) {
      setEntryStatus("error");
      setMsg(err instanceof Error ? err.message : "Failed to create entry");
    }
  }

  const canSubmit =
    !!productName && !!category && !!price && !!purchaseDate && parseFloat(price) >= 0;

  return (
    <div className="bg-surface border border-default rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">Create New Entry</h2>
        <PanelCloseButton onClick={onClose} />
      </div>

      <div className="space-y-1">
        <Label>Product / Bill Name</Label>
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="e.g., Netflix Subscription"
          className={inputClass()}
        />
      </div>

      <CategorySelect
        value={category}
        onChange={setCategory}
        categories={categories}
      />

      <div className="space-y-1">
        <Label>Price</Label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0.00"
          className={inputClass()}
        />
      </div>

      <div className="space-y-1">
        <Label>Purchase Date</Label>
        <input
          type="datetime-local"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className={inputClass()}
        />
      </div>

      <StatusSelect value={status} onChange={setStatus} />

      <button
        onClick={handleCreate}
        disabled={entryStatus === "loading" || !canSubmit}
        className="w-full py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        {entryStatus === "loading" ? "Creating…" : "Create Entry"}
      </button>

      <StatusMessage status={entryStatus} message={msg} />
    </div>
  );
}

// ─── Edit Entry Panel ─────────────────────────────────────────────────────────

function EditEntryPanel({
  entry,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  entry: FinanceEntry;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [productName, setProductName] = useState(entry.product_name);
  const [category, setCategory] = useState(entry.category);
  const [price, setPrice] = useState(entry.price.toString());
  const [purchaseDate, setPurchaseDate] = useState(
    toLocalDatetimeValue(entry.purchase_date)
  );
  const [status, setStatus] = useState<"planned" | "done">(entry.status);
  const [saveStatus, setSaveStatus] = useState<Status>("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<Status>("idle");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset state when the selected entry changes. Adjusting state during
  // render (rather than in an effect) avoids a cascading extra render.
  const [prevEntryId, setPrevEntryId] = useState(entry.id);
  if (prevEntryId !== entry.id) {
    setPrevEntryId(entry.id);
    setProductName(entry.product_name);
    setCategory(entry.category);
    setPrice(entry.price.toString());
    setPurchaseDate(toLocalDatetimeValue(entry.purchase_date));
    setStatus(entry.status);
    setSaveStatus("idle");
    setSaveMsg(null);
    setDeleteStatus("idle");
    setDeleteMsg(null);
    setConfirmDelete(false);
  }

  async function handleUpdate() {
    setSaveStatus("loading");
    setSaveMsg(null);

    const date = new Date(purchaseDate);

    if (isNaN(date.getTime())) {
      setSaveStatus("error");
      setSaveMsg("Invalid date values.");
      return;
    }

    try {
      const res = await fetch(`/api/finance/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          product_name: productName.trim(),
          category,
          price: parseFloat(price),
          purchase_date: date.toISOString(),
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");

      setSaveStatus("success");
      setSaveMsg("Entry updated.");
      onSaved();
    } catch (err) {
      setSaveStatus("error");
      setSaveMsg(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleDelete() {
    setDeleteStatus("loading");
    setDeleteMsg(null);

    try {
      const res = await fetch("/api/finance/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entry_id: entry.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");

      setDeleteStatus("success");
      setDeleteMsg("Entry deleted.");
      onDeleted();
    } catch (err) {
      setDeleteStatus("error");
      setDeleteMsg(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const canSave =
    !!productName &&
    !!category &&
    !!price &&
    !!purchaseDate &&
    parseFloat(price) >= 0;

  return (
    <div className="bg-surface border border-default rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">Edit Entry #{entry.id}</h2>
        <PanelCloseButton onClick={onClose} />
      </div>

      <div className="space-y-1">
        <Label>Product / Bill Name</Label>
        <input
          type="text"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          className={inputClass()}
        />
      </div>

      <CategorySelect
        value={category}
        onChange={setCategory}
        categories={categories}
      />

      <div className="space-y-1">
        <Label>Price</Label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={inputClass()}
        />
      </div>

      <div className="space-y-1">
        <Label>Purchase Date</Label>
        <input
          type="datetime-local"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className={inputClass()}
        />
      </div>

      <StatusSelect value={status} onChange={setStatus} />

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={handleUpdate}
          disabled={saveStatus === "loading" || !canSave}
          className="col-span-3 py-2.5 rounded-lg bg-invert text-invert-fg font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {saveStatus === "loading" ? "Saving…" : "Save Changes"}
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-opacity"
        >
          Delete
        </button>
      </div>

      <StatusMessage status={saveStatus} message={saveMsg} />

      {confirmDelete && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-2">
          <p className="text-sm text-center text-red-700 dark:text-red-300">
            Delete entry?
          </p>
          <p className="text-xs text-center text-muted">
            {entry.product_name} — {formatPrice(entry.price)} —{" "}
            {formatDate(entry.purchase_date)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2 rounded-lg border border-strong bg-surface-raised text-secondary text-sm font-medium hover:bg-surface-hover transition-colors"
            >
              No
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteStatus === "loading"}
              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40 transition-opacity"
            >
              {deleteStatus === "loading" ? "Deleting…" : "Yes"}
            </button>
          </div>
          <StatusMessage status={deleteStatus} message={deleteMsg} />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceManagePage() {
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showItauModal, setShowItauModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllChecked() {
    setCheckedIds((prev) =>
      prev.size === entries.length
        ? new Set()
        : new Set(entries.map((e) => e.id))
    );
  }

  async function deleteChecked() {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/finance/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entry_ids: ids }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete entries");

      // The entry open in the edit panel may have just been deleted.
      if (selectedId !== null && checkedIds.has(selectedId)) {
        setSelectedId(null);
      }
      setCheckedIds(new Set());
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete entries");
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, catsRes] = await Promise.all([
        warmFetch("/api/finance", { credentials: "include" }),
        warmFetch("/api/finance/categories"),
      ]);
      if (!entriesRes.ok) throw new Error("Failed to fetch finance entries");
      const { entries: e } = await entriesRes.json();
      setEntries(e ?? []);
      if (catsRes.ok) {
        const { categories: c } = await catsRes.json();
        setCategories(c ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch finance entries");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  function openEntryForm() {
    setShowEntryForm(true);
    setSelectedId(null);
  }

  function closeEntryForm() {
    setShowEntryForm(false);
  }

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-5xl mx-auto space-y-6 text-primary">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Manage Finance</h1>
          <p className="text-sm text-muted mt-1">
            {showEntryForm
              ? "Fill in the details to create a new entry."
              : "Select an entry to edit its details."}
          </p>
        </div>
        <div className="flex gap-2">
          <ImportMenu
            onSelectCsv={() => setShowImportModal(true)}
            onSelectItauPdf={() => setShowItauModal(true)}
            buttonClassName="text-sm px-3 py-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
          />
          <button
            onClick={() => setShowGenerateModal(true)}
            className="text-sm px-3 py-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
          >
            Bulk Add
          </button>
          <a
            href="/namu/user/finance"
            className="text-sm px-3 py-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
          >
            Dashboard
          </a>
          <button
            onClick={() => (showEntryForm ? closeEntryForm() : openEntryForm())}
            className="text-sm px-3 py-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
          >
            {showEntryForm ? "✕ Close" : "+ New Entry"}
          </button>
          <button
            onClick={() => setShowCatForm((v) => !v)}
            className="text-sm px-3 py-2 rounded-lg border border-default bg-surface-raised hover:bg-surface-hover transition-colors"
          >
            {showCatForm ? "✕ Close" : "+ New Category"}
          </button>
        </div>
      </div>

      {/* Category Panel */}
      {showCatForm && (
        <CategoryPanel
          categories={categories}
          onClose={() => setShowCatForm(false)}
        />
      )}

      {/* Main Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EntryList
          entries={entries}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={(entry) => {
            setSelectedId(entry.id);
            setShowEntryForm(false);
          }}
          checkedIds={checkedIds}
          onToggle={toggleChecked}
          onToggleAll={toggleAllChecked}
          onDeleteChecked={() => setConfirmingDelete(true)}
          deleting={deleting}
        />

        <div>
          {showEntryForm ? (
            <CreateEntryPanel
              categories={categories}
              onClose={closeEntryForm}
              onCreated={fetchAll}
            />
          ) : selectedEntry ? (
            <EditEntryPanel
              key={selectedEntry.id}
              entry={selectedEntry}
              categories={categories}
              onClose={() => setSelectedId(null)}
              onSaved={fetchAll}
              onDeleted={() => {
                setSelectedId(null);
                fetchAll();
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-default text-sm text-dim">
              Select an entry to edit
            </div>
          )}
        </div>
      </div>

      <BatchImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        importType="finance"
        onImportSuccess={fetchAll}
      />

      <ItauPdfImportModal
        isOpen={showItauModal}
        onClose={() => setShowItauModal(false)}
        onImportSuccess={fetchAll}
      />

      <BatchGenerateModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onSuccess={fetchAll}
      />

      <ConfirmDialog
        isOpen={confirmingDelete}
        title="Delete entries"
        message={`Delete ${checkedIds.size} ${
          checkedIds.size === 1 ? "entry" : "entries"
        }? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={deleteChecked}
        onCancel={() => setConfirmingDelete(false)}
      />
    </main>
  );
}
