"use client";

import { useEffect, useState, useMemo } from "react";
import type {
  TodoItem,
  Category,
  Tag,
  StatusFilter,
  PriorityFilter,
  RecurrenceRule,
} from "@/lib/types";
import { TodoList, type SortOption } from "@/components/todo/TodoList";
import { TodoForm } from "@/components/todo/TodoForm";
import { SummaryCards } from "@/components/todo/SummaryCards";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const FILTERS_STORAGE_KEY = "todoFilters";

type PersistedFilters = {
  statusFilter: StatusFilter;
  priorityFilter: PriorityFilter;
  categoryFilter: string;
  tagFilter: string[];
  searchQuery: string;
  sortOption: SortOption;
};

const DEFAULT_FILTERS: PersistedFilters = {
  statusFilter: "all",
  priorityFilter: "all",
  categoryFilter: "",
  tagFilter: [],
  searchQuery: "",
  sortOption: "priority",
};

type SubmitData = {
  title: string;
  category: string;
  description: string;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  recurrence_rule: RecurrenceRule;
  tags: string[];
};

export default function TodoPage() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<TodoItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TodoItem | null>(null);

  const [filters, setFilters] = useState<PersistedFilters>(DEFAULT_FILTERS);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  async function fetchTodoItems() {
    try {
      const res = await fetch("/api/todo", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch To Do items");
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    try {
      const res = await fetch("/api/todo/categories");
      if (!res.ok) return;
      const data = await res.json();
      setCategories(data.categories ?? []);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  }

  async function fetchTags() {
    try {
      const res = await fetch("/api/todo/tags");
      if (!res.ok) return;
      const data = await res.json();
      setAllTags(data.tags ?? []);
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    }
  }

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchTodoItems(), fetchCategories(), fetchTags()]);

      try {
        const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
        if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
      } catch {
        // ignore malformed/unavailable storage
      }
    })();
  }, []);

  // Press "n" to open a fresh Create form, unless typing in a field or the
  // form is already open.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (showForm) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setEditingItem(null);
      setShowForm(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm]);

  function updateFilters(partial: Partial<PersistedFilters>) {
    setFilters((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function resolveTagObjects(names: string[], previousTags: Tag[]): Tag[] {
    return names.map((name, i) => {
      const existing =
        previousTags.find((t) => t.name === name) ??
        allTags.find((t) => t.name === name);
      return existing ?? { id: -(i + 1), name };
    });
  }

  // Create TODO item — optimistic append using the server's response, which
  // already includes real ids for title/category/tags, so no refetch needed.
  async function handleCreateTodo(data: SubmitData) {
    const res = await fetch("/api/todo/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Failed to create To Do");

    const now = new Date().toISOString();
    const newItem: TodoItem = {
      id: body.item.id,
      category: body.item.category,
      title: body.item.title,
      description: body.item.description || null,
      priority: body.item.priority,
      status: "pending",
      due_date: body.item.due_date,
      recurrence_rule: body.item.recurrence_rule ?? "none",
      recurrence_parent_id: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
      tags: body.item.tags ?? [],
    };
    setItems((prev) => [newItem, ...prev]);

    if (newItem.tags.some((t) => !allTags.some((at) => at.id === t.id))) {
      fetchTags();
    }
  }

  // Update TODO item — merge submitted fields locally (the PUT endpoint only
  // returns {id}, not the full row), avoiding a full-list refetch.
  async function handleUpdateTodo(data: SubmitData) {
    if (!editingItem) return;
    const target = editingItem;

    const res = await fetch(`/api/todo/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update To Do");
    }

    const resolvedTags = resolveTagObjects(data.tags, target.tags);
    setItems((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? {
              ...item,
              title: data.title,
              category: data.category,
              description: data.description || null,
              priority: data.priority,
              due_date: data.due_date,
              recurrence_rule: data.recurrence_rule,
              tags: resolvedTags,
            }
          : item
      )
    );
    setEditingItem(null);

    if (resolvedTags.some((t) => t.id < 0)) {
      fetchTags();
    }
  }

  // Toggle complete — optimistic flip with rollback on failure. Recurring
  // items get one quiet background refetch afterward to reveal the
  // server-spawned next occurrence (its fields aren't in this response).
  async function handleToggleComplete(item: TodoItem) {
    const newStatus = item.status === "completed" ? "pending" : "completed";
    const previous = item;

    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? {
              ...i,
              status: newStatus,
              completed_at: newStatus === "completed" ? new Date().toISOString() : null,
            }
          : i
      )
    );

    try {
      const res = await fetch(`/api/todo/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update To Do");
      }

      if (newStatus === "completed" && previous.recurrence_rule !== "none") {
        fetchTodoItems();
      }
    } catch (err) {
      console.error("Failed to toggle complete:", err);
      setItems((prev) => prev.map((i) => (i.id === item.id ? previous : i)));
    }
  }

  // Delete TODO item — optimistic removal with rollback on failure.
  async function handleConfirmDelete() {
    const item = deleteTarget;
    if (!item) return;
    setDeleteTarget(null);

    const previousItems = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    try {
      const res = await fetch("/api/todo/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ item_id: item.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete To Do");
      }
    } catch (err) {
      console.error("Failed to delete TODO:", err);
      setItems(previousItems);
    }
  }

  function handleEdit(item: TodoItem) {
    setEditingItem(item);
    setShowForm(true);
  }

  function handleCategoryCreated(category: Category) {
    setCategories((prev) =>
      prev.some((c) => c.id === category.id) ? prev : [...prev, category]
    );
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  function toggleSelectItem(item: TodoItem) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  async function handleBulkStatusChange(status: "pending" | "in_progress" | "completed") {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const previousItems = items;
    setItems((prev) =>
      prev.map((item) =>
        ids.includes(item.id)
          ? {
              ...item,
              status,
              completed_at: status === "completed" ? new Date().toISOString() : null,
            }
          : item
      )
    );
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/todo/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          updates: ids.map((item_id) => ({ item_id, status })),
        }),
      });
      if (!res.ok) throw new Error("Bulk update failed");

      if (status === "completed" && ids.some((id) => {
        const item = previousItems.find((i) => i.id === id);
        return item && item.recurrence_rule !== "none";
      })) {
        fetchTodoItems();
      }
    } catch (err) {
      console.error("Bulk status update failed:", err);
      setItems(previousItems);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const previousItems = items;
    setItems((prev) => prev.filter((item) => !ids.includes(item.id)));
    setSelectedIds(new Set());

    try {
      await Promise.all(
        ids.map((item_id) =>
          fetch("/api/todo/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ item_id }),
          })
        )
      );
    } catch (err) {
      console.error("Bulk delete failed:", err);
      setItems(previousItems);
    }
  }

  // Master category list (not derived from currently-loaded items), so a
  // zero-todo category still shows up as a filter option.
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  return (
    <main className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">
            To Do
          </h1>
          <p className="text-sm text-muted mt-1">
            Manage your tasks
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingItem(null);
          }}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-invert hover:bg-invert-hover transition active:scale-[0.97] text-invert-fg"
        >
          + Add To Do
        </button>
      </div>

      <SummaryCards items={items} />

      <TodoForm
        isOpen={showForm}
        categories={categories}
        onCategoryCreated={handleCategoryCreated}
        editingItem={editingItem}
        onClose={() => {
          setShowForm(false);
          setEditingItem(null);
        }}
        onSubmit={editingItem ? handleUpdateTodo : handleCreateTodo}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete To Do item"
        message={`Delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <TodoList
        items={items}
        loading={loading}
        error={error}
        statusFilter={filters.statusFilter}
        priorityFilter={filters.priorityFilter}
        categoryFilter={filters.categoryFilter}
        tagFilter={filters.tagFilter}
        searchQuery={filters.searchQuery}
        sortOption={filters.sortOption}
        onStatusFilterChange={(v) => updateFilters({ statusFilter: v })}
        onPriorityFilterChange={(v) => updateFilters({ priorityFilter: v })}
        onCategoryFilterChange={(v) => updateFilters({ categoryFilter: v })}
        onTagFilterChange={(v) => updateFilters({ tagFilter: v })}
        onSearchQueryChange={(v) => updateFilters({ searchQuery: v })}
        onSortOptionChange={(v) => updateFilters({ sortOption: v })}
        onToggleComplete={handleToggleComplete}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        categories={categoryNames}
        allTags={allTags}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        selectedIds={selectedIds}
        onToggleSelectItem={toggleSelectItem}
        onBulkStatusChange={handleBulkStatusChange}
        onBulkDelete={handleBulkDelete}
      />
    </main>
  );
}
