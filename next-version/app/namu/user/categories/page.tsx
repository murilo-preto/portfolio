"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeCategoryName } from "@/lib/categoryName";

// ─── Types ───────────────────────────────────────────────────────────────────
//
// Declared locally rather than in lib/types.ts: `mine`/`others` only exist on
// the /category/usage responses this screen calls, and nothing else needs them.

type NamespaceKey = "time" | "finance" | "todo";

type CategoryUsage = {
  id: number;
  name: string;
  /** Entries of the signed-in user in this category. */
  mine: number;
  /** Entries of *other* users — the lookup tables are shared, see below. */
  others: number;
};

type Namespace = {
  key: NamespaceKey;
  label: string;
  /** What the category is attached to, for counts: "3 entries", "3 items". */
  noun: string;
  nounPlural: string;
  /** Base path of the proxies under /api. */
  base: string;
  /** Finance names are normalized on write, so preview that in the UI too. */
  normalizes: boolean;
};

const NAMESPACES: Namespace[] = [
  {
    key: "time",
    label: "Time",
    noun: "entry",
    nounPlural: "entries",
    base: "/api/category",
    normalizes: false,
  },
  {
    key: "finance",
    label: "Finance",
    noun: "entry",
    nounPlural: "entries",
    base: "/api/finance/category",
    normalizes: true,
  },
  {
    key: "todo",
    label: "Todo",
    noun: "item",
    nounPlural: "items",
    base: "/api/todo/category",
    normalizes: false,
  },
];

type Status = "idle" | "loading" | "success" | "error";

/** Which inline form a row currently has open. */
type RowMode = "none" | "rename" | "merge" | "delete";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countLabel(n: number, ns: Namespace): string {
  return `${n} ${n === 1 ? ns.noun : ns.nounPlural}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-neutral-400";

const GHOST_BUTTON_CLASS =
  "text-xs px-2.5 py-1.5 rounded-lg border border-default bg-surface-raised " +
  "hover:bg-surface-hover transition-colors disabled:opacity-40 " +
  "disabled:cursor-not-allowed";

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber";
}) {
  const tones = {
    neutral: "bg-surface-hover text-secondary",
    amber: "bg-tint-amber-a text-tint-amber-ink border border-tint-amber-line",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function CategoryRow({
  namespace,
  category,
  siblings,
  onChanged,
  onError,
}: {
  namespace: Namespace;
  category: CategoryUsage;
  siblings: CategoryUsage[];
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>("none");
  const [name, setName] = useState(category.name);
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Someone else's entries live in this category, and the lookup tables have no
  // owner column — so renaming or removing it would reach into their data. The
  // backend refuses those, and the row says so up front rather than letting the
  // user find out from a 409.
  const shared = category.others > 0;

  const previewName = namespace.normalizes ? normalizeCategoryName(name) : name.trim();
  const renameChanged = previewName !== category.name && previewName.length > 0;

  function close() {
    setMode("none");
    setName(category.name);
    setTargetId("");
  }

  async function send(url: string, init: RequestInit, fallback: string) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        onError(await readError(res, fallback));
        return false;
      }
      return true;
    } catch {
      onError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!renameChanged) return;
    const ok = await send(
      `${namespace.base}/${category.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: previewName }),
      },
      "Failed to rename category",
    );
    if (ok) {
      close();
      onChanged(`Renamed "${category.name}" to "${previewName}".`);
    }
  }

  async function handleMerge() {
    if (!targetId) return;
    const target = siblings.find((c) => String(c.id) === targetId);
    const ok = await send(
      `${namespace.base}/${category.id}/merge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into: Number(targetId) }),
      },
      "Failed to merge categories",
    );
    if (ok) {
      close();
      onChanged(`Merged "${category.name}" into "${target?.name ?? "category"}".`);
    }
  }

  async function handleDelete() {
    // The FK is ON DELETE RESTRICT: a category still in use can only go if its
    // entries are moved somewhere first.
    if (category.mine > 0 && !targetId) return;
    const ok = await send(
      `${namespace.base}/${category.id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          targetId ? { reassign_to: Number(targetId) } : {},
        ),
      },
      "Failed to delete category",
    );
    if (ok) {
      close();
      onChanged(`Deleted "${category.name}".`);
    }
  }

  return (
    <li className="rounded-xl border border-default bg-surface-raised px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-medium text-sm truncate">{category.name}</span>
          <Pill>{countLabel(category.mine, namespace)}</Pill>
          {shared && (
            <Pill tone="amber">
              shared · {countLabel(category.others, namespace)} from other users
            </Pill>
          )}
        </div>

        <div className="flex gap-1.5 shrink-0">
          <button
            className={GHOST_BUTTON_CLASS}
            disabled={shared}
            title={shared ? "Other users' entries use this category" : undefined}
            onClick={() => setMode(mode === "rename" ? "none" : "rename")}
          >
            Rename
          </button>
          <button
            className={GHOST_BUTTON_CLASS}
            disabled={shared || siblings.length === 0}
            title={shared ? "Other users' entries use this category" : undefined}
            onClick={() => setMode(mode === "merge" ? "none" : "merge")}
          >
            Merge
          </button>
          <button
            className={`${GHOST_BUTTON_CLASS} text-red-600 dark:text-red-400`}
            disabled={shared}
            title={shared ? "Other users' entries use this category" : undefined}
            onClick={() => setMode(mode === "delete" ? "none" : "delete")}
          >
            Delete
          </button>
        </div>
      </div>

      {mode === "rename" && (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            maxLength={100}
            className={`${INPUT_CLASS} flex-1 min-w-48`}
          />
          <button
            onClick={handleRename}
            disabled={busy || !renameChanged}
            className="px-3 py-2 rounded-lg bg-invert text-invert-fg text-sm font-medium disabled:opacity-40"
          >
            {busy ? "…" : "Save"}
          </button>
          <button onClick={close} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          {namespace.normalizes && previewName !== name.trim() && (
            <p className="basis-full text-xs text-muted">
              Will be saved as “{previewName}”.
            </p>
          )}
        </div>
      )}

      {mode === "merge" && (
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className={`${INPUT_CLASS} flex-1 min-w-48`}
          >
            <option value="">Merge into…</option>
            {siblings.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleMerge}
            disabled={busy || !targetId}
            className="px-3 py-2 rounded-lg bg-invert text-invert-fg text-sm font-medium disabled:opacity-40"
          >
            {busy ? "…" : "Merge"}
          </button>
          <button onClick={close} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <p className="basis-full text-xs text-muted">
            Moves your {countLabel(category.mine, namespace)} across, then removes
            “{category.name}”.
          </p>
        </div>
      )}

      {mode === "delete" && (
        <div className="flex gap-2 flex-wrap items-center">
          {category.mine > 0 && (
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className={`${INPUT_CLASS} flex-1 min-w-48`}
            >
              <option value="">Move my {namespace.nounPlural} to…</option>
              {siblings.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleDelete}
            disabled={busy || (category.mine > 0 && !targetId)}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40"
          >
            {busy ? "…" : "Delete"}
          </button>
          <button onClick={close} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <p className="basis-full text-xs text-muted">
            {category.mine > 0
              ? `“${category.name}” still holds ${countLabel(category.mine, namespace)}; pick where they should go.`
              : `“${category.name}” is unused and can be removed.`}
          </p>
        </div>
      )}
    </li>
  );
}

// ─── Namespace panel ─────────────────────────────────────────────────────────

function NamespacePanel({ namespace }: { namespace: Namespace }) {
  const [categories, setCategories] = useState<CategoryUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${namespace.base}/usage`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to load categories"));
      const data = await res.json();
      setCategories(data.categories ?? []);
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Failed to load categories",
      );
    } finally {
      setLoading(false);
    }
  }, [namespace.base]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  function report(status: Status, text: string) {
    setStatus(status);
    setMessage(text);
  }

  async function handleChanged(text: string) {
    report("success", text);
    await load();
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch(namespace.base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to create category"));
      setNewName("");
      report(
        "success",
        res.status === 200 ? `“${name}” already exists.` : `Created “${name}”.`,
      );
      await load();
    } catch (err) {
      report("error", err instanceof Error ? err.message : "Failed to create category");
    } finally {
      setCreating(false);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return categories;
    return categories.filter((c) => c.name.toLocaleLowerCase().includes(needle));
  }, [categories, query]);

  const totals = useMemo(
    () => ({
      unused: categories.filter((c) => c.mine === 0 && c.others === 0).length,
      shared: categories.filter((c) => c.others > 0).length,
    }),
    [categories],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder={`New ${namespace.label.toLowerCase()} category…`}
          maxLength={100}
          className={`${INPUT_CLASS} flex-1 min-w-48`}
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="px-4 py-2 rounded-lg bg-invert text-invert-fg text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {creating ? "…" : "Create"}
        </button>
      </div>

      {message && (
        <p
          className={`text-sm ${status === "success" ? "text-tint-green-ink dark:text-green-400" : "text-red-500"}`}
        >
          {message}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted uppercase tracking-wide">
          {loading
            ? "Loading…"
            : `${categories.length} categories · ${totals.unused} unused · ${totals.shared} shared`}
        </p>
        {categories.length > 6 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className={`${INPUT_CLASS} py-1.5 w-40`}
          />
        )}
      </div>

      {!loading && categories.length === 0 && (
        <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-default text-sm text-dim">
          No categories yet
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((category) => (
          <CategoryRow
            key={category.id}
            namespace={namespace}
            category={category}
            siblings={categories.filter((c) => c.id !== category.id)}
            onChanged={handleChanged}
            onError={(text) => report("error", text)}
          />
        ))}
      </ul>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const [active, setActive] = useState<NamespaceKey>("time");
  const namespace = NAMESPACES.find((n) => n.key === active) ?? NAMESPACES[0];

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-3xl mx-auto space-y-6 text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Categories</h1>
        <p className="text-sm text-muted mt-1">
          Rename, merge, or remove a category across time, finance, and todo. The
          count beside each one is how many of your own records would be affected.
        </p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-surface-inset border border-default w-fit">
        {NAMESPACES.map((n) => (
          <button
            key={n.key}
            onClick={() => setActive(n.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              n.key === active
                ? "bg-invert text-invert-fg"
                : "text-secondary hover:bg-surface-hover"
            }`}
          >
            {n.label}
          </button>
        ))}
      </div>

      {/* Remounted per namespace so each panel loads its own data cleanly. */}
      <NamespacePanel key={namespace.key} namespace={namespace} />
    </main>
  );
}
