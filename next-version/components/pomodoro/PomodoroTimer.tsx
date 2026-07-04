"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PomodoroSettings, TodoItem } from "@/lib/types";
import {
  type TimerMode,
  type TimerRunState,
  STATE_STORAGE_KEY,
  getDurationSeconds,
  modeToSessionType,
  modeLabel,
  formatTime,
  playChime,
  notifyCompletion,
  ensureNotificationPermission,
} from "./utils";

type PomodoroTimerProps = {
  settings: PomodoroSettings;
  selectedTodo: TodoItem | null;
  onClearSelectedTodo: () => void;
};

type PersistedState = {
  mode: TimerMode;
  runState: TimerRunState;
  endTimestamp: number | null;
  remainingSeconds: number | null;
  sessionId: number | null;
  todoId: number | null;
  sessionsCompleted: number;
};

function persist(state: PersistedState) {
  try {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable — session just won't survive a refresh.
  }
}

export function PomodoroTimer({
  settings,
  selectedTodo,
  onClearSelectedTodo,
}: PomodoroTimerProps) {
  const [mode, setMode] = useState<TimerMode>("pomodoro");
  const [runState, setRunState] = useState<TimerRunState>("idle");
  const [displaySeconds, setDisplaySeconds] = useState(
    getDurationSeconds("pomodoro", settings)
  );
  const [sessionsCompleted, setSessionsCompleted] = useState(0);
  const [justCompleted, setJustCompleted] = useState<TimerMode | null>(null);

  // Refs mirror the state above so the tick interval and the
  // navigation-cleanup handler always see current values without having to
  // recreate the interval (which was the source of the original drift bug).
  const endTimestampRef = useRef<number | null>(null);
  const remainingSecondsRef = useRef<number | null>(null);
  const sessionIdRef = useRef<number | null>(null);
  const modeRef = useRef<TimerMode>("pomodoro");
  const runStateRef = useRef<TimerRunState>("idle");
  const settingsRef = useRef(settings);
  const selectedTodoRef = useRef(selectedTodo);
  const sessionsCompletedRef = useRef(0);
  const restoredRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    selectedTodoRef.current = selectedTodo;
  }, [selectedTodo]);

  const persistCurrent = useCallback(() => {
    persist({
      mode: modeRef.current,
      runState: runStateRef.current,
      endTimestamp: endTimestampRef.current,
      remainingSeconds: remainingSecondsRef.current,
      sessionId: sessionIdRef.current,
      todoId: selectedTodoRef.current?.id ?? null,
      sessionsCompleted: sessionsCompletedRef.current,
    });
  }, []);

  const cancelBackendSession = useCallback((sessionId: number) => {
    try {
      const payload = new Blob([JSON.stringify({ session_id: sessionId })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/pomodoro/cancel", payload);
    } catch {
      // Best-effort only — the backend self-heals dangling sessions the
      // next time this user starts a new one.
    }
  }, []);

  const completeBackendSession = useCallback(
    async (sessionId: number, durationSeconds: number) => {
      try {
        await fetch("/api/pomodoro/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            session_id: sessionId,
            duration_seconds: durationSeconds,
          }),
        });
      } catch (err) {
        console.error("Failed to complete Pomodoro session:", err);
      }
    },
    []
  );

  const startBackendSession = useCallback(
    async (currentMode: TimerMode, todoId: number | null) => {
      try {
        const res = await fetch("/api/pomodoro/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            session_type: modeToSessionType(currentMode),
            ...(currentMode === "pomodoro" && todoId ? { todo_id: todoId } : {}),
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.session_id as number;
      } catch (err) {
        console.error("Failed to start Pomodoro session:", err);
        return null;
      }
    },
    []
  );

  // Advance to the next mode after a session ends, mirroring the classic
  // pomodoro/short-break/.../long-break cadence.
  const advanceMode = useCallback((finishedMode: TimerMode) => {
    if (finishedMode === "pomodoro") {
      const nextCount = sessionsCompletedRef.current + 1;
      sessionsCompletedRef.current = nextCount;
      setSessionsCompleted(nextCount);
      const nextMode: TimerMode =
        nextCount % settingsRef.current.sessionsBeforeLongBreak === 0
          ? "longBreak"
          : "shortBreak";
      modeRef.current = nextMode;
      setMode(nextMode);
      setDisplaySeconds(getDurationSeconds(nextMode, settingsRef.current));
    } else {
      modeRef.current = "pomodoro";
      setMode("pomodoro");
      setDisplaySeconds(getDurationSeconds("pomodoro", settingsRef.current));
    }
  }, []);

  const finishSession = useCallback(
    (finishedMode: TimerMode, sessionId: number | null, durationSeconds: number) => {
      runStateRef.current = "idle";
      setRunState("idle");
      endTimestampRef.current = null;
      remainingSecondsRef.current = null;
      sessionIdRef.current = null;

      if (sessionId) {
        completeBackendSession(sessionId, durationSeconds);
      }

      playChime();
      notifyCompletion(
        finishedMode === "pomodoro" ? "Pomodoro complete" : "Break complete",
        finishedMode === "pomodoro"
          ? "Time for a break."
          : "Time to get back to it."
      );

      setJustCompleted(finishedMode);
      setTimeout(() => setJustCompleted(null), 4000);

      advanceMode(finishedMode);
      persistCurrent();
    },
    [advanceMode, completeBackendSession, persistCurrent]
  );

  // ── Restore from localStorage on mount ────────────────────────────────
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STATE_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;

    let parsed: PersistedState;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    modeRef.current = parsed.mode;
    setMode(parsed.mode);
    sessionsCompletedRef.current = parsed.sessionsCompleted ?? 0;
    setSessionsCompleted(parsed.sessionsCompleted ?? 0);
    sessionIdRef.current = parsed.sessionId ?? null;

    if (parsed.runState === "running" && parsed.endTimestamp) {
      const remaining = Math.ceil((parsed.endTimestamp - Date.now()) / 1000);
      if (remaining > 0) {
        endTimestampRef.current = parsed.endTimestamp;
        runStateRef.current = "running";
        setRunState("running");
        setDisplaySeconds(remaining);
      } else {
        // The session would have completed while the tab was away — finish
        // it now so the completion side effects (notify/backend) still fire.
        const fullDuration = getDurationSeconds(parsed.mode, settingsRef.current);
        finishSession(parsed.mode, parsed.sessionId, fullDuration);
      }
    } else if (parsed.runState === "paused" && parsed.remainingSeconds != null) {
      runStateRef.current = "paused";
      setRunState("paused");
      remainingSecondsRef.current = parsed.remainingSeconds;
      setDisplaySeconds(parsed.remainingSeconds);
    } else {
      setDisplaySeconds(getDurationSeconds(parsed.mode, settingsRef.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Countdown tick: single stable interval anchored to an absolute
  // timestamp, so background-tab throttling can never cause drift — each
  // tick recomputes from wall-clock time rather than decrementing a counter.
  useEffect(() => {
    if (runState !== "running") return;

    const interval = setInterval(() => {
      if (endTimestampRef.current == null) return;
      const remaining = Math.max(
        0,
        Math.ceil((endTimestampRef.current - Date.now()) / 1000)
      );
      setDisplaySeconds(remaining);

      if (remaining <= 0) {
        const finishedMode = modeRef.current;
        const sessionId = sessionIdRef.current;
        const fullDuration = getDurationSeconds(finishedMode, settingsRef.current);
        finishSession(finishedMode, sessionId, fullDuration);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [runState, finishSession]);

  // ── Cleanup on navigation away: best-effort cancel of the in-progress
  // backend session; the backend's self-heal-on-next-start is the
  // authoritative fallback if this never fires (crash, force-quit).
  useEffect(() => {
    function handlePageHide() {
      if (runStateRef.current !== "idle" && sessionIdRef.current) {
        cancelBackendSession(sessionIdRef.current);
      }
    }
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [cancelBackendSession]);

  async function handleStart() {
    await ensureNotificationPermission();

    if (runState === "paused" && remainingSecondsRef.current != null) {
      endTimestampRef.current = Date.now() + remainingSecondsRef.current * 1000;
      remainingSecondsRef.current = null;
      runStateRef.current = "running";
      setRunState("running");
      persistCurrent();
      return;
    }

    const currentMode = modeRef.current;
    const duration = getDurationSeconds(currentMode, settingsRef.current);
    endTimestampRef.current = Date.now() + duration * 1000;
    runStateRef.current = "running";
    setRunState("running");
    setDisplaySeconds(duration);
    persistCurrent();

    const sessionId = await startBackendSession(
      currentMode,
      selectedTodoRef.current?.id ?? null
    );
    sessionIdRef.current = sessionId;
    persistCurrent();
  }

  function handlePause() {
    if (endTimestampRef.current == null) return;
    remainingSecondsRef.current = Math.max(
      0,
      Math.ceil((endTimestampRef.current - Date.now()) / 1000)
    );
    endTimestampRef.current = null;
    runStateRef.current = "paused";
    setRunState("paused");
    persistCurrent();
  }

  function handleReset() {
    if (sessionIdRef.current) {
      cancelBackendSession(sessionIdRef.current);
    }
    sessionIdRef.current = null;
    endTimestampRef.current = null;
    remainingSecondsRef.current = null;
    runStateRef.current = "idle";
    setRunState("idle");
    setDisplaySeconds(getDurationSeconds(modeRef.current, settingsRef.current));
    persistCurrent();
  }

  function switchMode(newMode: TimerMode) {
    if (runStateRef.current !== "idle" && sessionIdRef.current) {
      cancelBackendSession(sessionIdRef.current);
    }
    sessionIdRef.current = null;
    endTimestampRef.current = null;
    remainingSecondsRef.current = null;
    runStateRef.current = "idle";
    modeRef.current = newMode;
    setMode(newMode);
    setRunState("idle");
    setDisplaySeconds(getDurationSeconds(newMode, settingsRef.current));
    persistCurrent();
  }

  function getModeColor(m: TimerMode): string {
    switch (m) {
      case "pomodoro":
        return "text-red-500";
      case "shortBreak":
        return "text-green-500";
      case "longBreak":
        return "text-blue-500";
    }
  }

  const totalDuration = getDurationSeconds(mode, settings);
  const progress = ((totalDuration - displaySeconds) / totalDuration) * 100;

  return (
    <div className="bg-white dark:bg-neutral-900 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      {/* Mode Selector */}
      <div className="flex gap-2 mb-6">
        {(["pomodoro", "shortBreak", "longBreak"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === m
                ? m === "pomodoro"
                  ? "bg-red-500 text-white"
                  : m === "shortBreak"
                  ? "bg-green-500 text-white"
                  : "bg-blue-500 text-white"
                : "bg-gray-100 dark:bg-neutral-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-neutral-700"
            }`}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>

      {/* Timer Display */}
      <div className="text-center mb-6">
        <div
          className={`font-mono text-6xl font-bold tracking-widest transition-colors ${
            runState === "running" ? getModeColor(mode) : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {formatTime(displaySeconds)}
        </div>

        <div className="w-full h-2 bg-gray-200 dark:bg-neutral-700 rounded-full mt-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              mode === "pomodoro"
                ? "bg-red-500"
                : mode === "shortBreak"
                ? "bg-green-500"
                : "bg-blue-500"
            }`}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>

        {justCompleted && (
          <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm font-medium">
            {justCompleted === "pomodoro" ? "Pomodoro complete! 🎉" : "Break complete — back to it!"}
          </div>
        )}

        {selectedTodo && mode === "pomodoro" && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-neutral-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Working on</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {selectedTodo.title}
            </p>
            <button
              onClick={onClearSelectedTodo}
              className="text-xs text-red-500 hover:text-red-600 mt-1"
            >
              Clear selection
            </button>
          </div>
        )}

        {sessionsCompleted > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {sessionsCompleted} pomodoro{sessionsCompleted !== 1 ? "s" : ""} completed
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-3">
        {runState === "running" ? (
          <>
            <button
              onClick={handlePause}
              className="py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
            >
              Pause
            </button>
            <button
              onClick={handleReset}
              className="py-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-medium transition-colors"
            >
              Cancel
            </button>
          </>
        ) : runState === "paused" ? (
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
        ) : (
          <button
            onClick={handleStart}
            className="col-span-2 py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
          >
            {mode === "pomodoro" ? "Start Pomodoro" : "Start Break"}
          </button>
        )}
      </div>
    </div>
  );
}
