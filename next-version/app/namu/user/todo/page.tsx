"use client";

import { useEffect, useState, useMemo } from "react";
import type { TodoItem, Category, PomodoroSession, StatusFilter, PriorityFilter } from "../../../../components/todo/types";
import { TodoList } from "../../../../components/todo/TodoList";
import { TodoForm } from "../../../../components/todo/TodoForm";
import { PomodoroTimer } from "../../../../components/todo/PomodoroTimer";
import { PomodoroStats } from "../../../../components/todo/PomodoroStats";
import { SummaryCards } from "../../../../components/todo/SummaryCards";

export default function TodoPage() {
  // TODO items state
  const [items, setItems] = useState<TodoItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<TodoItem | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  // Pomodoro sessions today
  const [pomodoroSessionsToday, setPomodoroSessionsToday] = useState(0);

  // Fetch TODO items
  async function fetchTodoItems() {
    try {
      const res = await fetch("/api/todo", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch TODO items");
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // Fetch categories
  async function fetchCategories() {
    try {
      const res = await fetch("/api/todo/categories");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch categories");
      }
      const data = await res.json();
      setCategories(data.categories ?? []);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  }

  // Fetch Pomodoro sessions
  async function fetchPomodoroSessions() {
    try {
      const res = await fetch("/api/pomodoro/sessions", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      
      // Count today's completed sessions
      const today = new Date().toDateString();
      const todaySessions = (data.sessions ?? []).filter((s: PomodoroSession) => {
        const sessionDate = new Date(s.session_date);
        return s.completed && sessionDate.toDateString() === today;
      });
      
      setPomodoroSessionsToday(todaySessions.length);
    } catch (err) {
      console.error("Failed to fetch Pomodoro sessions:", err);
    }
  }

  useEffect(() => {
    fetchTodoItems();
    fetchCategories();
    fetchPomodoroSessions();
  }, []);

  // Create TODO item
  async function handleCreateTodo(data: {
    title: string;
    category: string;
    description: string;
    priority: "low" | "medium" | "high";
    due_date: string | null;
  }) {
    const res = await fetch("/api/todo/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to create TODO");
    }

    await fetchTodoItems();
  }

  // Update TODO item
  async function handleUpdateTodo(data: {
    title: string;
    category: string;
    description: string;
    priority: "low" | "medium" | "high";
    due_date: string | null;
  }) {
    if (!editingItem) return;

    const res = await fetch(`/api/todo/${editingItem.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to update TODO");
    }

    await fetchTodoItems();
    setEditingItem(null);
  }

  // Toggle complete
  async function handleToggleComplete(item: TodoItem) {
    const newStatus = item.status === "completed" ? "pending" : "completed";

    try {
      const res = await fetch(`/api/todo/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update TODO");
      }

      await fetchTodoItems();
    } catch (err) {
      console.error("Failed to toggle complete:", err);
    }
  }

  // Delete TODO item
  async function handleDeleteTodo(item: TodoItem) {
    if (!confirm(`Delete "${item.title}"?`)) return;

    try {
      const res = await fetch("/api/todo/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ item_id: item.id }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete TODO");
      }

      await fetchTodoItems();
    } catch (err) {
      console.error("Failed to delete TODO:", err);
    }
  }

  // Handle edit
  function handleEdit(item: TodoItem) {
    setEditingItem(item);
    setShowForm(true);
  }

  // Handle Pomodoro complete
  async function handlePomodoroComplete(duration: number) {
    // Update the session in backend (done in PomodoroTimer component)
    // Just refresh the sessions count
    await fetchPomodoroSessions();
  }

  // Handle Pomodoro cancel
  async function handlePomodoroCancel() {
    // Session already cancelled in backend
    await fetchPomodoroSessions();
  }

  // Get unique categories from items
  const uniqueCategories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category));
    return Array.from(cats);
  }, [items]);

  return (
    <main className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
            TODO & Pomodoro
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your tasks and track focus sessions
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingItem(null);
          }}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-neutral-800 dark:bg-neutral-100 hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors text-white dark:text-neutral-900"
        >
          + Add TODO
        </button>
      </div>

      {/* Summary Cards */}
      <SummaryCards items={items} pomodoroSessionsToday={pomodoroSessionsToday} />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - TODO List */}
        <div className="lg:col-span-2 space-y-6">
          {/* TODO Form Modal */}
          {showForm && (
            <TodoForm
              categories={categories}
              editingItem={editingItem}
              onClose={() => {
                setShowForm(false);
                setEditingItem(null);
              }}
              onSubmit={editingItem ? handleUpdateTodo : handleCreateTodo}
            />
          )}

          {/* TODO List */}
          <TodoList
            items={items}
            loading={loading}
            error={error}
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            categoryFilter={categoryFilter}
            onStatusFilterChange={setStatusFilter}
            onPriorityFilterChange={setPriorityFilter}
            onCategoryFilterChange={setCategoryFilter}
            onToggleComplete={handleToggleComplete}
            onEdit={handleEdit}
            onDelete={handleDeleteTodo}
            onSelectForPomodoro={setSelectedTodo}
            selectedTodo={selectedTodo}
            categories={uniqueCategories}
          />
        </div>

        {/* Right Column - Pomodoro Timer & Stats */}
        <div className="space-y-6">
          <PomodoroTimer
            selectedTodo={selectedTodo}
            onSelectTodo={setSelectedTodo}
            onComplete={handlePomodoroComplete}
            onCancel={handlePomodoroCancel}
          />
          <PomodoroStats />
        </div>
      </div>
    </main>
  );
}
