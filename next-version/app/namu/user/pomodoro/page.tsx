"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PomodoroSettings as PomodoroSettingsType, TodoItem } from "@/lib/types";
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer";
import { PomodoroStats } from "@/components/pomodoro/PomodoroStats";
import { PomodoroSettings } from "@/components/pomodoro/PomodoroSettings";
import { TaskPicker } from "@/components/pomodoro/TaskPicker";
import { loadSettings, saveSettings } from "@/components/pomodoro/utils";
import { warmFetch } from "@/lib/prefetch";

function PomodoroPageContent() {
  const searchParams = useSearchParams();
  const deepLinkTodoId = searchParams.get("todo_id");

  const [settings, setSettings] = useState<PomodoroSettingsType | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);
  const [todosError, setTodosError] = useState<string | null>(null);
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);

  useEffect(() => {
    // Restoring persisted settings must happen after mount: reading
    // localStorage during render would cause an SSR hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    async function fetchTodos() {
      try {
        const res = await warmFetch("/api/todo", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load To Do items");
        const data = await res.json();
        const items = (data.items as TodoItem[]).filter(
          (item) => item.status !== "completed"
        );
        setTodos(items);

        if (deepLinkTodoId) {
          const match = items.find((item) => item.id === Number(deepLinkTodoId));
          if (match) setSelectedTodo(match);
        }
      } catch (err: unknown) {
        setTodosError(err instanceof Error ? err.message : "Failed to load To Do items");
      } finally {
        setTodosLoading(false);
      }
    }
    fetchTodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSettingsChange(next: PomodoroSettingsType) {
    setSettings(next);
    saveSettings(next);
  }

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
