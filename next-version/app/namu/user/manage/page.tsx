"use client";

import { useEffect, useState } from "react";

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

function toLocalDatetimeValue(iso: string): string {
  // Convert "YYYY-MM-DD HH:MM:SS" or ISO string to datetime-local input value
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

export default function ManagePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Entry creation
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [createStatus, setCreateStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Category creation
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catStatus, setCatStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [catMsg, setCatMsg] = useState<string | null>(null);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, catsRes] = await Promise.all([
        fetch("/api/entries", { credentials: "include" }),
        fetch("/api/categories"),
      ]);

      if (!entriesRes.ok) throw new Error("Failed to fetch entries");
      const entriesData = await entriesRes.json();
      setEntries(entriesData.entries ?? []);

      if (catsRes.ok) {
        const catsData = await catsRes.json();
        setCategories(catsData.categories ?? []);
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

  function selectEntry(entry: Entry) {
    setSelectedId(entry.id);
    setEditCategory(entry.category);
    setEditStart(toLocalDatetimeValue(entry.start_time));
    setEditEnd(toLocalDatetimeValue(entry.end_time));
    setSubmitStatus("idle");
    setSubmitMsg(null);
  }

  async function handleUpdate() {
    if (!selectedId) return;
    setSubmitStatus("loading");
    setSubmitMsg(null);

    const startDate = new Date(editStart);
    const endDate = new Date(editEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setSubmitStatus("error");
      setSubmitMsg("Invalid date values.");
      return;
    }

    if (endDate <= startDate) {
      setSubmitStatus("error");
      setSubmitMsg("End time must be after start time.");
      return;
    }

    try {
      const res = await fetch(`/api/entry/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          category: editCategory,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");

      setSubmitStatus("success");
      setSubmitMsg("Entry updated.");
      await fetchAll();
      // Re-select the same entry to reflect updated data
      setSelectedId(selectedId);
    } catch (err: any) {
      setSubmitStatus("error");
      setSubmitMsg(err.message);
    }
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) return;
    setCatStatus("loading");
    setCatMsg(null);

    try {
      const res = await fetch("/api/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create category");

      setCatStatus("success");
      setCatMsg(
        res.status === 200
          ? `"${newCatName.trim()}" already exists.`
          : `Category "${newCatName.trim()}" created!`,
      );
      setNewCatName("");
      // Refresh categories
      const catsRes = await fetch("/api/categories");
      if (catsRes.ok) {
        const catsData = await catsRes.json();
        setCategories(catsData.categories ?? []);
      }
    } catch (err: any) {
      setCatStatus("error");
      setCatMsg(err.message);
    }
  }

  async function handleCreate() {
    if (!newCategory || !newStart || !newEnd) return;
    setCreateStatus("loading");
    setCreateMsg(null);

    const startDate = new Date(newStart);
    const endDate = new Date(newEnd);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setCreateStatus("error");
      setCreateMsg("Invalid date values.");
      return;
    }

    if (endDate <= startDate) {
      setCreateStatus("error");
      setCreateMsg("End time must be after start time.");
      return;
    }

    try {
      const tokenRes = await fetch("/api/token", { credentials: "include" });
      if (!tokenRes.ok) throw new Error("Not authenticated. Please log in.");
      const tokenData = await tokenRes.json();
      const username: string = tokenData.user;

      const res = await fetch("/api/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username,
          category: newCategory,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create entry");

      setCreateStatus("success");
      setCreateMsg("Entry created!");
      setNewCategory("");
      setNewStart("");
      setNewEnd("");
      await fetchAll();
    } catch (err: any) {
      setCreateStatus("error");
      setCreateMsg(err.message);
    }
  }

  const selectedEntry = entries.find((e) => e.id === selectedId);

  const durationSeconds =
    editStart && editEnd
      ? Math.floor(
          (new Date(editEnd).getTime() - new Date(editStart).getTime()) / 1000,
        )
      : null;

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
          <button
            onClick={() => {
              setShowEntryForm((v) => !v);
              setCreateStatus("idle");
              setCreateMsg(null);
              setNewCategory("");
              setNewStart("");
              setNewEnd("");
              setSelectedId(null);
            }}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            {showEntryForm ? "✕ Close" : "+ New Entry"}
          </button>
          <button
            onClick={() => {
              setShowCatForm((v) => !v);
              setCatStatus("idle");
              setCatMsg(null);
              setNewCatName("");
            }}
            className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
          >
            {showCatForm ? "✕ Close" : "+ New Category"}
          </button>
        </div>
      </div>

      {/* New Category Panel */}
      {showCatForm && (
        <div className="bg-bone dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-4 space-y-3">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Create Category
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateCategory()}
              placeholder="Category name…"
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
            />
            <button
              onClick={handleCreateCategory}
              disabled={catStatus === "loading" || !newCatName.trim()}
              className="px-4 py-2 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {catStatus === "loading" ? "…" : "Create"}
            </button>
          </div>
          {catMsg && (
            <p
              className={`text-sm ${
                catStatus === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-500"
              }`}
            >
              {catMsg}
            </p>
          )}
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
      )}

      {/* Main layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Entry List */}
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

          <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
            {entries.map((entry) => {
              const isSelected = entry.id === selectedId;
              return (
                <button
                  key={entry.id}
                  onClick={() => selectEntry(entry)}
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
                      className={`text-xs font-mono shrink-0 ${
                        isSelected
                          ? "text-gray-300 dark:text-neutral-600"
                          : "text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {formatDuration(entry.duration_seconds)}
                    </span>
                  </div>
                  <div
                    className={`text-xs mt-0.5 ${
                      isSelected
                        ? "text-gray-300 dark:text-neutral-500"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {formatDate(entry.start_time)} →{" "}
                    {formatDate(entry.end_time)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Edit Panel */}
        <div>
          {showEntryForm ? (
            <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">Create New Entry</h2>
                <button
                  onClick={() => {
                    setShowEntryForm(false);
                    setCreateStatus("idle");
                    setCreateMsg(null);
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Category
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                >
                  <option value="">— Select category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start time */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                />
              </div>

              {/* End time */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                />
              </div>

              {/* Duration preview */}
              {(() => {
                const dur =
                  newStart && newEnd
                    ? Math.floor(
                        (new Date(newEnd).getTime() -
                          new Date(newStart).getTime()) /
                          1000,
                      )
                    : null;
                if (dur !== null && dur > 0) {
                  return (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Duration: {formatDuration(dur)}
                    </p>
                  );
                }
                if (dur !== null && dur <= 0) {
                  return (
                    <p className="text-xs text-red-500">
                      End time must be after start time.
                    </p>
                  );
                }
                return null;
              })()}

              {/* Submit */}
              <button
                onClick={handleCreate}
                disabled={
                  createStatus === "loading" ||
                  !newCategory ||
                  !newStart ||
                  !newEnd
                }
                className="w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {createStatus === "loading" ? "Creating…" : "Create Entry"}
              </button>

              {createMsg && (
                <p
                  className={`text-sm text-center ${
                    createStatus === "success"
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-500"
                  }`}
                >
                  {createMsg}
                </p>
              )}
            </div>
          ) : !selectedEntry ? (
            <div className="flex items-center justify-center h-48 rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 text-sm text-gray-400 dark:text-gray-500">
              Select an entry to edit
            </div>
          ) : (
            <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-base">
                  Edit Entry #{selectedEntry.id}
                </h2>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
                >
                  ✕
                </button>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Category
                </label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                >
                  <option value="">— Select category —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Start time */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Start Time
                </label>
                <input
                  type="datetime-local"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                />
              </div>

              {/* End time */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  End Time
                </label>
                <input
                  type="datetime-local"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                />
              </div>

              {/* Duration preview */}
              {durationSeconds !== null && durationSeconds > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Duration: {formatDuration(durationSeconds)}
                </p>
              )}
              {durationSeconds !== null && durationSeconds <= 0 && (
                <p className="text-xs text-red-500">
                  End time must be after start time.
                </p>
              )}

              {/* Submit */}
              <button
                onClick={handleUpdate}
                disabled={
                  submitStatus === "loading" ||
                  !editCategory ||
                  !editStart ||
                  !editEnd ||
                  (durationSeconds !== null && durationSeconds <= 0)
                }
                className="w-full py-2.5 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {submitStatus === "loading" ? "Saving…" : "Save Changes"}
              </button>

              {submitMsg && (
                <p
                  className={`text-sm text-center ${
                    submitStatus === "success"
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-500"
                  }`}
                >
                  {submitMsg}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
