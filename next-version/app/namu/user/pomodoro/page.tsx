"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  Category,
  PomodoroSettings as PomodoroSettingsType,
  TodoItem,
} from "@/lib/types";
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer";
import { PomodoroStats } from "@/components/pomodoro/PomodoroStats";
import { PomodoroSettings } from "@/components/pomodoro/PomodoroSettings";
import { TaskPicker } from "@/components/pomodoro/TaskPicker";
import { FocusLogging } from "@/components/pomodoro/FocusLogging";
import { loadSettings, saveSettings } from "@/components/pomodoro/utils";
import {
  DEFAULT_PREFERENCE_SETTINGS,
  fetchPreferences,
  savePreferences,
  type FocusPreferences,
} from "@/lib/preferences";
import { warmFetch } from "@/lib/prefetch";

function PomodoroPageContent() {
  const searchParams = useSearchParams();
  const deepLinkTodoId = searchParams.get("todo_id");

  const [settings, setSettings] = useState<PomodoroSettingsType | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);
  const [todosError, setTodosError] = useState<string | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);

  // Focus-to-time-entry logging, and the time categories it can target.
  const [focus, setFocus] = useState<FocusPreferences>(
    DEFAULT_PREFERENCE_SETTINGS.focus
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [focusLoading, setFocusLoading] = useState(true);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [focusSaving, setFocusSaving] = useState(false);

  useEffect(() => {
    // Restoring persisted settings must happen after mount: reading
    // localStorage during render would cause an SSR hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
  }, []);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await warmFetch("/api/todo", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load To Do items");
      const data = await res.json();
      const items = (data.items as TodoItem[]).filter(
        (item) => item.status !== "completed"
      );
      setTodos(items);
      return items;
    } catch (err: unknown) {
      setTodosError(
        err instanceof Error ? err.message : "Failed to load To Do items"
      );
      return null;
    } finally {
      setTodosLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadTodos() {
      const items = await fetchTodos();
      if (items && deepLinkTodoId) {
        const match = items.find((item) => item.id === Number(deepLinkTodoId));
        if (match) setSelectedTodo(match);
      }
    }
    loadTodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function loadFocus() {
      try {
        const [prefs, catRes] = await Promise.all([
          fetchPreferences(),
          warmFetch("/api/categories"),
        ]);
        if (!catRes.ok) throw new Error("Failed to load categories");
        const catJson = await catRes.json();
        setCategories(catJson.categories ?? []);
        setFocus(prefs.settings.focus ?? DEFAULT_PREFERENCE_SETTINGS.focus);
      } catch (err: unknown) {
        setFocusError(
          err instanceof Error ? err.message : "Failed to load focus settings"
        );
      } finally {
        setFocusLoading(false);
      }
    }
    loadFocus();
  }, []);

  // Optimistic: the control reflects the choice immediately and rolls back if
  // the save fails, rather than lagging a round trip behind every click.
  async function handleFocusChange(next: FocusPreferences) {
    const previous = focus;
    setFocus(next);
    setFocusSaving(true);
    setFocusError(null);
    try {
      await savePreferences({ settings: { focus: next } });
    } catch (err: unknown) {
      setFocus(previous);
      setFocusError(
        err instanceof Error ? err.message : "Failed to save focus settings"
      );
    } finally {
      setFocusSaving(false);
    }
  }

  function handleSettingsChange(next: PomodoroSettingsType) {
    setSettings(next);
    saveSettings(next);
  }

  // A session just moved its task to in_progress, or the user marked it done —
  // either way the picker's copy is stale.
  const handleTodosChanged = useCallback(async () => {
    const items = await fetchTodos();
    if (!items) return;
    setSelectedTodo((current) =>
      current ? items.find((item) => item.id === current.id) ?? null : null
    );
  }, [fetchTodos]);

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-6xl mx-auto space-y-6 text-primary">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">
            Pomodoro
          </h1>
          <p className="text-sm text-muted mt-1">
            Focus in timed sessions, with short and long breaks
          </p>
        </div>
        <a
          href="/namu/user/todo"
          className="text-sm px-4 py-2 rounded-lg border border-default
                     bg-surface-raised hover:bg-surface-hover
                     transition-colors text-gray-700 dark:text-gray-200 font-medium"
        >
          View To Dos
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {settings && (
            <PomodoroTimer
              settings={settings}
              selectedTodo={selectedTodo}
              onClearSelectedTodo={() => setSelectedTodo(null)}
              logCategory={focus.logToTimeEntries ? focus.category : null}
              onTodosChanged={handleTodosChanged}
            />
          )}
          {settings && (
            <PomodoroSettings settings={settings} onChange={handleSettingsChange} />
          )}
        </div>

        <div className="flex flex-col gap-6">
          <TaskPicker
            todos={todos}
            loading={todosLoading}
            error={todosError}
            selectedTodo={selectedTodo}
            onSelectTodo={setSelectedTodo}
          />
          <FocusLogging
            focus={focus}
            categories={categories}
            loading={focusLoading}
            error={focusError}
            saving={focusSaving}
            onChange={handleFocusChange}
          />
          <PomodoroStats />
        </div>
      </div>
    </main>
  );
}

export default function PomodoroPage() {
  return (
    <Suspense fallback={null}>
      <PomodoroPageContent />
    </Suspense>
  );
}
