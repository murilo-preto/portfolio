"use client";

import { useState, useEffect, useRef } from "react";
import type { TodoItem } from "./types";

type PomodoroTimerProps = {
  selectedTodo: TodoItem | null;
  onSelectTodo: (todo: TodoItem | null) => void;
  onComplete: (duration: number) => Promise<void>;
  onCancel: () => Promise<void>;
};

const POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
const SHORT_BREAK = 5 * 60;
const LONG_BREAK = 15 * 60;

type TimerMode = "pomodoro" | "shortBreak" | "longBreak";
type TimerState = "idle" | "running" | "paused" | "completed";

export function PomodoroTimer({
  selectedTodo,
  onSelectTodo,
  onComplete,
  onCancel,
}: PomodoroTimerProps) {
  const [mode, setMode] = useState<TimerMode>("pomodoro");
  const [state, setState] = useState<TimerState>("idle");
  const [timeLeft, setTimeLeft] = useState(POMODORO_DURATION);
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getDuration = (m: TimerMode) => {
    switch (m) {
      case "pomodoro":
        return POMODORO_DURATION;
      case "shortBreak":
        return SHORT_BREAK;
      case "longBreak":
        return LONG_BREAK;
    }
  };

  // Timer tick
  useEffect(() => {
    if (state === "running" && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && state === "running") {
      setState("completed");
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state, timeLeft]);

  // Start session with backend
  async function startSession() {
    try {
      const body: { todo_id?: number } = {};
      if (selectedTodo) {
        body.todo_id = selectedTodo.id;
      }

      const res = await fetch("/api/pomodoro/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start session");
      }

      const data = await res.json();
      setSessionId(data.session_id);
    } catch (err: any) {
      console.error("Failed to start Pomodoro session:", err);
    }
  }

  function handleStart() {
    if (state === "idle" || state === "paused") {
      if (state === "idle" && mode === "pomodoro") {
        startSession();
      }
      setState("running");
    }
  }

  function handlePause() {
    setState("paused");
  }

  function handleReset() {
    setState("idle");
    setTimeLeft(getDuration(mode));
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }

  async function handleComplete() {
    const duration = getDuration(mode) - timeLeft;
    
    if (mode === "pomodoro" && sessionId) {
      try {
        await fetch("/api/pomodoro/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            session_id: sessionId,
            duration_seconds: duration,
          }),
        });
      } catch (err) {
        console.error("Failed to complete session:", err);
      }
    }

    setSessionsCompleted((prev) => (mode === "pomodoro" ? prev + 1 : prev));
    
    // Auto-suggest break after pomodoro
    if (mode === "pomodoro") {
      const newMode = (sessionsCompleted + 1) % 4 === 0 ? "longBreak" : "shortBreak";
      setMode(newMode);
      setTimeLeft(getDuration(newMode));
    }
    
    setState("idle");
    setSessionId(null);
  }

  async function handleCancel() {
    if (sessionId) {
      try {
        await fetch("/api/pomodoro/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch (err) {
        console.error("Failed to cancel session:", err);
      }
    }
    await onCancel();
    handleReset();
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function getModeLabel(): string {
    switch (mode) {
      case "pomodoro":
        return "Pomodoro";
      case "shortBreak":
        return "Short Break";
      case "longBreak":
        return "Long Break";
    }
  }

  function getModeColor(): string {
    switch (mode) {
      case "pomodoro":
        return "text-red-500";
      case "shortBreak":
        return "text-green-500";
      case "longBreak":
        return "text-blue-500";
    }
  }

  // Switch mode
  function switchMode(newMode: TimerMode) {
    setMode(newMode);
    setTimeLeft(getDuration(newMode));
    setState("idle");
    setSessionId(null);
  }

  const progress = ((getDuration(mode) - timeLeft) / getDuration(mode)) * 100;

  return (
    <div className="bg-white dark:bg-neutral-900 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Pomodoro Timer
        </h2>
        <span className={`text-xs font-medium ${getModeColor()}`}>
          {getModeLabel()}
        </span>
      </div>

      {/* Mode Selector */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => switchMode("pomodoro")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "pomodoro"
              ? "bg-red-500 text-white"
              : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
          }`}
        >
          Pomodoro
        </button>
        <button
          onClick={() => switchMode("shortBreak")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "shortBreak"
              ? "bg-green-500 text-white"
              : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
          }`}
        >
          Short Break
        </button>
        <button
          onClick={() => switchMode("longBreak")}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "longBreak"
              ? "bg-blue-500 text-white"
              : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
          }`}
        >
          Long Break
        </button>
      </div>

      {/* Timer Display */}
      <div className="text-center mb-6">
        <div
          className={`font-mono text-6xl font-bold tracking-widest transition-colors ${
            state === "running"
              ? getModeColor()
              : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {formatTime(timeLeft)}
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-gray-200 dark:bg-neutral-700 rounded-full mt-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              mode === "pomodoro"
                ? "bg-red-500"
                : mode === "shortBreak"
                ? "bg-green-500"
                : "bg-blue-500"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Selected TODO */}
        {selectedTodo && mode === "pomodoro" && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              Working on
            </p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {selectedTodo.title}
            </p>
            <button
              onClick={() => onSelectTodo(null)}
              className="text-xs text-red-500 hover:text-red-600 mt-1"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Session counter */}
        {sessionsCompleted > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {sessionsCompleted} pomodoro{sessionsCompleted !== 1 ? "s" : ""} completed
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3">
        {state === "running" ? (
          <>
            <button
              onClick={handlePause}
              className="py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
            >
              Pause
            </button>
            <button
              onClick={handleCancel}
              className="py-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-medium transition-colors"
            >
              Cancel
            </button>
          </>
        ) : state === "paused" ? (
          <>
            <button
              onClick={handleStart}
              className="py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
            >
              Resume
            </button>
            <button
              onClick={handleReset}
              className="py-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-medium transition-colors"
            >
              Reset
            </button>
          </>
        ) : state === "completed" ? (
          <>
            <button
              onClick={handleComplete}
              className="col-span-2 py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
            >
              Complete Session
            </button>
          </>
        ) : (
          <button
            onClick={handleStart}
            disabled={mode !== "pomodoro" && !selectedTodo}
            className="col-span-2 py-3 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {mode === "pomodoro" ? "Start Pomodoro" : "Start Break"}
          </button>
        )}
      </div>

      {/* Keyboard hint */}
      <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">
        Tip: Select a TODO item to track what you&apos;re working on
      </p>
    </div>
  );
}
