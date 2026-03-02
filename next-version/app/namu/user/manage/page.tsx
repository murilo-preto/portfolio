"use client";

import { useEffect, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "error";

type Entry = {
  id: number;
  category: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
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

function calcDuration(start: string, end: string): number | null {
  if (!start || !end) return null;
  return Math.floor(
    (new Date(end).getTime() - new Date(start).getTime()) / 1000,
  );
}

// ─── Shared UI Primitives ────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
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
      className={`text-sm text-center ${status === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
    >
      {message}
    </p>
  );
}

function DurationPreview({ start, end }: { start: string; end: string }) {
  const dur = calcDuration(start, end);
  if (dur === null) return null;
  if (dur <= 0)
    return (
      <p className="text-xs text-red-500">End time must be after start time.</p>
    );
  return (
    <p className="text-xs text-gray-500 dark:text-gray-400">
      Duration: {formatDuration(dur)}
    </p>
  );
}

function inputClass() {
  return "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400";
}

function PanelCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
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

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass()}
      />
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
      const res = await fetch("/api/category", {
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

      // Refresh categories list in parent via page reload or callback
      const catsRes = await fetch("/api/categories");
      if (catsRes.ok) {
        // Parent will re-fetch on next fetchAll; trigger it by re-mounting
      }
    } catch (err: any) {
      setStatus("error");
      setMsg(err.message);
    }
  }

  return (
    <div className="bg-bone dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300 uppercase tracking-wide">
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
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
        <button
          onClick={handleCreate}
          disabled={status === "loading" || !name.trim()}
          className="px-4 py-2 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
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
              className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-neutral-700 text-gray-600 dark:text-gray-300"
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
}: {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  selectedId: number | null;
  onSelect: (entry: Entry) => void;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {loading ? "Loading…" : `${entries.length} Entries`}
      </h2>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">
          No entries found.
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
            <button
              key={entry.id}
              onClick={() => onSelect(entry)}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                isSelected
                  ? "border-neutral-800 dark:border-neutral-300 bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-gray-400 dark:hover:border-neutral-500"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">
                  {entry.category}
                </span>
                <span
                  className={`text-xs font-mono shrink-0 ${isSelected ? "text-gray-300 dark:text-neutral-600" : "text-gray-400 dark:text-gray-500"}`}
                >
                  {formatDuration(entry.duration_seconds)}
                </span>
              </div>
              <div
                className={`text-xs mt-0.5 ${isSelected ? "text-gray-300 dark:text-neutral-500" : "text-gray-400 dark:text-gray-500"}`}
              >
                {formatDate(entry.start_time)} → {formatDate(entry.end_time)}
              </div>
            </button>
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
  const [category, setCategory] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function handleCreate() {
    if (!category || !start || !end) return;
    setStatus("loading");
    setMsg(null);

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setStatus("error");
      setMsg("Invalid date values.");
      return;
    }
    if (endDate <= startDate) {
      setStatus("error");
      setMsg("End time must be after start time.");
      return;
    }

    try {
      const tokenRes = await fetch("/api/token", { credentials: "include" });
      if (!tokenRes.ok) throw new Error("Not authenticated. Please log in.");
      const { user: username } = await tokenRes.json();

      const res = await fetch("/api/entry/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username,
          category,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create entry");

      setStatus("success");
      setMsg("Entry created!");
      setCategory("");
      setStart("");
      setEnd("");
      onCreated();
    } catch (err: any) {
      setStatus("error");
      setMsg(err.message);
    }
  }

  const dur = calcDuration(start, end);
  const canSubmit = !!category && !!start && !!end && (dur === null || dur > 0);

  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">Create New Entry</h2>
        <PanelCloseButton onClick={onClose} />
      </div>

      <CategorySelect
        value={category}
        onChange={setCategory}
        categories={categories}
      />
      <DateTimeField label="Start Time" value={start} onChange={setStart} />
      <DateTimeField label="End Time" value={end} onChange={setEnd} />
      <DurationPreview start={start} end={end} />

      <button
        onClick={handleCreate}
        disabled={status === "loading" || !canSubmit}
        className="w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        {status === "loading" ? "Creating…" : "Create Entry"}
      </button>

      <StatusMessage status={status} message={msg} />
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
  entry: Entry;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [category, setCategory] = useState(entry.category);
  const [start, setStart] = useState(toLocalDatetimeValue(entry.start_time));
  const [end, setEnd] = useState(toLocalDatetimeValue(entry.end_time));
  const [saveStatus, setSaveStatus] = useState<Status>("idle");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<Status>("idle");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset state when the selected entry changes
  useEffect(() => {
    setCategory(entry.category);
    setStart(toLocalDatetimeValue(entry.start_time));
    setEnd(toLocalDatetimeValue(entry.end_time));
    setSaveStatus("idle");
    setSaveMsg(null);
    setDeleteStatus("idle");
    setDeleteMsg(null);
    setConfirmDelete(false);
  }, [entry.id]);

  async function handleUpdate() {
    setSaveStatus("loading");
    setSaveMsg(null);

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setSaveStatus("error");
      setSaveMsg("Invalid date values.");
      return;
    }
    if (endDate <= startDate) {
      setSaveStatus("error");
      setSaveMsg("End time must be after start time.");
      return;
    }

    try {
      const res = await fetch(`/api/entry/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");

      setSaveStatus("success");
      setSaveMsg("Entry updated.");
      onSaved();
    } catch (err: any) {
      setSaveStatus("error");
      setSaveMsg(err.message);
    }
  }

  async function handleDelete() {
    setDeleteStatus("loading");
    setDeleteMsg(null);

    try {
      const res = await fetch("/api/entry/delete", {
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
    } catch (err: any) {
      setDeleteStatus("error");
      setDeleteMsg(err.message);
    }
  }

  const dur = calcDuration(start, end);
  const canSave = !!category && !!start && !!end && (dur === null || dur > 0);

  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">Edit Entry #{entry.id}</h2>
        <PanelCloseButton onClick={onClose} />
      </div>

      <CategorySelect
        value={category}
        onChange={setCategory}
        categories={categories}
      />
      <DateTimeField label="Start Time" value={start} onChange={setStart} />
      <DateTimeField label="End Time" value={end} onChange={setEnd} />
      <DurationPreview start={start} end={end} />

      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={handleUpdate}
          disabled={saveStatus === "loading" || !canSave}
          className="col-span-3 py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
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
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            {entry.category} — {formatDate(entry.start_time)} —{" "}
            {formatDuration(entry.duration_seconds)}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
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

export default function ManagePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, catsRes] = await Promise.all([
        fetch("/api/entry", { credentials: "include" }),
        fetch("/api/categories"),
      ]);
      if (!entriesRes.ok) throw new Error("Failed to fetch entries");
      const { entries: e } = await entriesRes.json();
      const sorted = (e ?? []).sort(
        (a: Entry, b: Entry) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      );
      setEntries(sorted);
      if (catsRes.ok) {
        const { categories: c } = await catsRes.json();
        setCategories(c ?? []);
      }
    } catch (err: any) {
      setError(err.message);
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
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-5xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Manage Entries</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {showEntryForm
              ? "Fill in the details to create a new entry."
              : "Select an entry to edit its details."}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/namu/user/csv"
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            Import from CSV
          </a>
          <button
            onClick={() => (showEntryForm ? closeEntryForm() : openEntryForm())}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            {showEntryForm ? "✕ Close" : "+ New Entry"}
          </button>
          <button
            onClick={() => setShowCatForm((v) => !v)}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
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
            <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
              Select an entry to edit
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
