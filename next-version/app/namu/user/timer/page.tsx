"use client";

import { useEffect, useRef, useState } from "react";

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
  }

  function handleStop() {
    const now = new Date();
    setEndTime(now);
    setEndInput(toLocalDatetimeValue(now));
    setTimerState("stopped");
  }

  function handleStartInputChange(value: string) {
    setStartInput(value);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      setStartTime(parsed);
      if (timerState === "running") {
        setElapsed(Math.floor((Date.now() - parsed.getTime()) / 1000));
      }
    }
  }

  function handleEndInputChange(value: string) {
    setEndInput(value);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) setEndTime(parsed);
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

      const res = await fetch("/api/entry", {
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
    } catch (err: any) {
      setSubmitStatus("error");
      setSubmitMessage(err.message);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isRunning = timerState === "running";
  const isStopped = timerState === "stopped";

  return (
    /*
     * max-w-xl keeps it centred on desktop.
     * p-4 on mobile, p-6 on larger screens.
     * space-y-6 tightens the gaps a bit for smaller screens.
     */
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
      {/* ── Title ── */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Timer</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Select a category, start the timer, then submit your entry.
        </p>
      </div>

      {/* ── Category Selector ── */}
      <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Category
        </label>

        {catLoading && (
          <p className="text-sm text-gray-400">Loading categories…</p>
        )}
        {catError && <p className="text-sm text-red-500">{catError}</p>}

        {!catLoading && !catError && (
          <select
            value={categoryId ?? ""}
            onChange={(e) =>
              setCategoryId(e.target.value ? Number(e.target.value) : null)
            }
            /* Bigger tap target on mobile via py-3 */
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3
                       text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-green-500
                       dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
          >
            <option value="">— select a category —</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Timer Display ── */}
      <div className="bg-bone dark:bg-neutral-900 p-6 rounded-xl shadow flex flex-col items-center gap-5">
        {/* Clock — smaller font on tiny screens */}
        <div
          className={`font-mono text-5xl sm:text-6xl font-bold tracking-widest transition-colors ${
            isRunning
              ? "text-green-500"
              : isStopped
                ? "text-gray-700 dark:text-gray-300"
                : "text-gray-400 dark:text-gray-600"
          }`}
        >
          {formatElapsed(
            isRunning
              ? elapsed
              : isStopped
                ? Math.max(0, durationSeconds ?? 0)
                : 0,
          )}
        </div>

        {/* Start / Stop — full-width on mobile for easy tapping */}
        <div className="w-full flex gap-3">
          {!isRunning ? (
            <button
              onClick={handleStart}
              className="flex-1 py-4 rounded-xl bg-green-500 hover:bg-green-600
                         text-white font-semibold text-lg transition active:scale-95"
            >
              {isStopped ? "Restart" : "Start"}
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex-1 py-4 rounded-xl bg-red-500 hover:bg-red-600
                         text-white font-semibold text-lg transition active:scale-95"
            >
              Stop
            </button>
          )}
        </div>

        {/* Status label */}
        <p className="text-xs text-gray-500 dark:text-gray-500 uppercase tracking-widest">
          {isRunning ? "Running…" : isStopped ? "Stopped" : "Idle"}
        </p>
      </div>

      {/* ── Time Editors ── */}
      <div className="bg-bone dark:bg-neutral-900 p-4 md:p-6 rounded-xl shadow space-y-4">
        <h2 className="font-semibold text-sm text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Adjust times
        </h2>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Start time
          </label>
          <input
            type="datetime-local"
            value={startInput}
            onChange={(e) => handleStartInputChange(e.target.value)}
            /* text-base prevents iOS from zooming in on focus */
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3
                       text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-green-500
                       dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            End time
          </label>
          <input
            type="datetime-local"
            value={endInput}
            onChange={(e) => handleEndInputChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3
                       text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-green-500
                       dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
          />
        </div>

        {durationSeconds !== null && (
          <p
            className={`text-sm font-medium ${
              durationSeconds > 0 ? "text-green-500" : "text-red-500"
            }`}
          >
            Duration: {formatElapsed(Math.max(0, durationSeconds))}
            {durationSeconds <= 0 && " — end must be after start"}
          </p>
        )}
      </div>

      {/* ── Submit ── */}
      <div className="space-y-3 pb-8">
        <button
          onClick={handleSubmit}
          disabled={!isValid || submitStatus === "loading"}
          className="w-full py-4 rounded-xl font-semibold text-white text-lg transition active:scale-95
                     bg-blue-600 hover:bg-blue-700
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitStatus === "loading" ? "Submitting…" : "Submit Entry"}
        </button>

        {/* Validation hints */}
        {!isValid && (
          <ul className="text-xs text-gray-400 dark:text-gray-500 space-y-0.5 pl-1">
            {!selectedCategory && <li>· Select a category</li>}
            {!startTime && <li>· Start the timer or set a start time</li>}
            {!endTime && <li>· Stop the timer or set an end time</li>}
            {durationSeconds !== null && durationSeconds <= 0 && (
              <li>· End time must be after start time</li>
            )}
          </ul>
        )}

        {/* Feedback */}
        {submitMessage && (
          <p
            className={`text-sm px-4 py-2 rounded-lg ${
              submitStatus === "success"
                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200"
                : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
            }`}
          >
            {submitMessage}
          </p>
        )}
      </div>
    </main>
  );
}
