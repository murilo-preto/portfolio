"use client";

import { useEffect, useRef, useState } from "react";
import { TimerDisplay } from "@/components/timer/TimerDisplay";
import { QuickStats } from "@/components/timer/QuickStats";
import { CategorySelector } from "@/components/timer/CategorySelector";
import { TimeInputs } from "@/components/timer/TimeInputs";

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = {
  id: number;
  name: string;
};

type TimerState = "idle" | "running" | "stopped";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TimerPage() {
  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);

  // Timer
  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual datetime edit fields
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");

  // Submission
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  // ── Load categories ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error("Failed to load categories");
        const json = await res.json();
        setCategories(json.categories ?? []);
      } catch (err: any) {
        setCatError(err.message);
      } finally {
        setCatLoading(false);
      }
    }
    fetchCategories();
  }, []);

  // ── Restore timer from localStorage ─────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem("timerState");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.categoryId) {
          setCategoryId(parsed.categoryId);
        }
        if (parsed.state === "running" && parsed.startTime) {
          setStartTime(new Date(parsed.startTime));
          setStartInput(toLocalDatetimeValue(new Date(parsed.startTime)));
          setTimerState("running");
          setElapsed(
            Math.floor(
              (Date.now() - new Date(parsed.startTime).getTime()) / 1000
            )
          );
        } else if (
          parsed.state === "stopped" &&
          parsed.startTime &&
          parsed.endTime
        ) {
          const start = new Date(parsed.startTime);
          const end = new Date(parsed.endTime);
          setStartTime(start);
          setEndTime(end);
          setStartInput(toLocalDatetimeValue(start));
          setEndInput(toLocalDatetimeValue(end));
          setTimerState("stopped");
        }
      } catch (e) {
        localStorage.removeItem("timerState");
      }
    }
  }, []);

  // ── Tick ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (timerState === "running" && startTime) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000));
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timerState, startTime]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space to start/stop (when not typing in input)
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        if (timerState === "running") {
          handleStop();
        } else if (timerState === "idle" && categoryId) {
          handleStart();
        } else if (timerState === "stopped" && categoryId) {
          handleStart();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timerState, categoryId, startTime, endTime]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  function handleStart() {
    const now = new Date();
    setStartTime(now);
    setEndTime(null);
    setElapsed(0);
    setStartInput(toLocalDatetimeValue(now));
    setEndInput("");
    setTimerState("running");
    setSubmitStatus("idle");
    setSubmitMessage(null);

    if (categoryId) {
      localStorage.setItem(
        "timerState",
        JSON.stringify({
          state: "running",
          startTime: now.toISOString(),
          categoryId,
        })
      );
    }
  }

  function handleStop() {
    const now = new Date();
    setEndTime(now);
    setEndInput(toLocalDatetimeValue(now));
    setTimerState("stopped");

    localStorage.setItem(
      "timerState",
      JSON.stringify({
        state: "stopped",
        startTime: startTime?.toISOString(),
        endTime: now.toISOString(),
        categoryId,
      })
    );
  }

  function handleStartInputChange(value: string) {
    setStartInput(value);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      setStartTime(parsed);
      if (timerState === "running") {
        setElapsed(Math.floor((Date.now() - parsed.getTime()) / 1000));
      }
      localStorage.setItem(
        "timerState",
        JSON.stringify({
          state: timerState,
          startTime: parsed.toISOString(),
          endTime: endTime?.toISOString(),
          categoryId,
        })
      );
    }
  }

  function handleEndInputChange(value: string) {
    setEndInput(value);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      setEndTime(parsed);
      localStorage.setItem(
        "timerState",
        JSON.stringify({
          state: timerState,
          startTime: startTime?.toISOString(),
          endTime: parsed.toISOString(),
          categoryId,
        })
      );
    }
  }

  // ── Validation ───────────────────────────────────────────────────────────────

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const durationSeconds =
    startTime && endTime
      ? Math.floor((endTime.getTime() - startTime.getTime()) / 1000)
      : null;

  const isValid =
    !!selectedCategory &&
    !!startTime &&
    !!endTime &&
    durationSeconds !== null &&
    durationSeconds > 0;

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!isValid || !startTime || !endTime || !selectedCategory) return;
    setSubmitStatus("loading");
    setSubmitMessage(null);

    try {
      const tokenRes = await fetch("/api/token", { credentials: "include" });
      if (!tokenRes.ok) throw new Error("Not authenticated. Please log in.");
      const tokenData = await tokenRes.json();
      const username: string = tokenData.user;

      const body = {
        username,
        category: selectedCategory.name,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      };

      const res = await fetch("/api/entry/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create entry");

      setSubmitStatus("success");
      setSubmitMessage("Entry submitted successfully!");

      // Reset
      setTimerState("idle");
      setStartTime(null);
      setEndTime(null);
      setElapsed(0);
      setStartInput("");
      setEndInput("");
      setCategoryId(null);
      localStorage.removeItem("timerState");
    } catch (err: any) {
      setSubmitStatus("error");
      setSubmitMessage(err.message);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isRunning = timerState === "running";
  const isStopped = timerState === "stopped";

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-6xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
            Timer
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track your time by category
          </p>
        </div>
        <a
          href="/namu/user/entries"
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 dark:border-neutral-700 
                     bg-white dark:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-700 
                     transition-colors text-gray-700 dark:text-gray-200 font-medium"
        >
          View Entries
        </a>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Timer and Category */}
        <div className="lg:col-span-2 space-y-6">
          {/* Timer Display */}
          <TimerDisplay
            elapsed={isRunning ? elapsed : isStopped ? Math.max(0, durationSeconds ?? 0) : 0}
            isRunning={isRunning}
            isStopped={isStopped}
            onStart={handleStart}
            onStop={handleStop}
            disabled={!categoryId}
          />

          {/* Category Selector */}
          <CategorySelector
            categories={categories}
            selectedId={categoryId}
            onSelect={setCategoryId}
            loading={catLoading}
            error={catError}
          />

          {/* Time Inputs */}
          <TimeInputs
            startInput={startInput}
            endInput={endInput}
            durationSeconds={durationSeconds}
            onStartChange={handleStartInputChange}
            onEndChange={handleEndInputChange}
          />
        </div>

        {/* Right Column - Stats and Submit */}
        <div className="flex flex-col gap-6">
          {/* Quick Stats - Grows to fill space */}
          <div className="flex-1">
            <QuickStats currentCategoryId={categoryId} />
          </div>

          {/* Submit Card */}
          <div className="bg-white dark:bg-neutral-900 p-5 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Submit Entry
            </h2>

            <button
              onClick={handleSubmit}
              disabled={!isValid || submitStatus === "loading"}
              className="w-full py-4 rounded-xl font-semibold text-white text-lg transition active:scale-95
                         bg-blue-600 hover:bg-blue-700
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
                         flex items-center justify-center gap-2"
            >
              {submitStatus === "loading" && (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {submitStatus === "loading" ? "Submitting..." : "Submit Entry"}
            </button>

            {/* Validation hints */}
            {!isValid && (
              <ul className="mt-4 text-xs text-gray-400 dark:text-gray-500 space-y-1">
                {!selectedCategory && (
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-gray-400 rounded-full" />
                    Select a category
                  </li>
                )}
                {!startTime && (
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-gray-400 rounded-full" />
                    Start the timer or set a start time
                  </li>
                )}
                {!endTime && (
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-gray-400 rounded-full" />
                    Stop the timer or set an end time
                  </li>
                )}
                {durationSeconds !== null && durationSeconds <= 0 && (
                  <li className="flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-gray-400 rounded-full" />
                    End time must be after start time
                  </li>
                )}
              </ul>
            )}

            {/* Feedback */}
            {submitMessage && (
              <div
                className={`mt-4 p-3 rounded-lg text-sm ${
                  submitStatus === "success"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {submitMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
