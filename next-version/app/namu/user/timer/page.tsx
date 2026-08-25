"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TimerDisplay } from "@/components/timer/TimerDisplay";
import { QuickStats } from "@/components/timer/QuickStats";
import { DailyTarget } from "@/components/timer/DailyTarget";
import { TodaySessions } from "@/components/timer/TodaySessions";
import { CategoryPicker } from "@/components/timer/CategoryPicker";
import { SessionSegments } from "@/components/timer/SessionSegments";
import {
  TIMER_STATE_KEY,
  formatDuration,
  formatEta,
  isSegmentValid,
  readTargets,
  splitClock,
  totalSeconds,
  writeTargets,
  type Segment,
  type TimerState,
} from "@/components/timer/utils";
import {
  ensureNotificationPermission,
  notifyCompletion,
  playChime,
} from "@/lib/notifications";

// ─── Types ───────────────────────────────────────────────────────────────────

type Category = {
  id: number;
  name: string;
};

type Entry = {
  id: number;
  category: string;
  duration_seconds: number;
  start_time: string;
  end_time?: string;
};

// Window used to rank categories, so the ones in recent use stay on the row.
const RECENT_WINDOW_DAYS = 14;

// Reference point for the recency window. Captured once per module load so
// render stays pure; the ranking only shifts on page reload, which is fine.
const NOW = Date.now();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function saveTimerState(state: unknown) {
  try {
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — the
    // timer just won't survive a refresh, which is a safe fallback.
  }
}

/**
 * Reads the persisted session, upgrading the pre-pause `{startTime, endTime}`
 * shape into segments so a timer running across a deploy isn't lost.
 */
function restoreSegments(parsed: {
  segments?: unknown;
  startTime?: string;
  endTime?: string;
}): Segment[] {
  if (Array.isArray(parsed.segments)) {
    return parsed.segments.filter(
      (seg): seg is Segment =>
        !!seg &&
        typeof seg === "object" &&
        typeof (seg as Segment).start === "string"
    );
  }
  if (parsed.startTime) {
    return [{ start: parsed.startTime, end: parsed.endTime ?? null }];
  }
  return [];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TimerPage() {
  // Categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [catLoading, setCatLoading] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);

  // Saved entries (feed Today's Activity and the daily target panel)
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);

  // Per-category daily targets, remembered in this browser
  const [targets, setTargets] = useState<Record<string, number>>({});

  // Timer
  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [elapsed, setElapsed] = useState(0);

  // Wall clock behind the projected finish time. It needs its own tick because
  // that projection slides forward whenever the timer *isn't* running, while
  // `elapsed` only advances during a live session. Null until mounted so the
  // server-rendered markup doesn't disagree with the client's clock.
  const [now, setNow] = useState<number | null>(null);

  // Submission
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  // ── Load categories ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch("/api/categories");
        if (!res.ok) throw new Error("Failed to load categories");
        const json = await res.json();
        setCategories(json.categories ?? []);
      } catch (err) {
        setCatError(err instanceof Error ? err.message : "Failed to load categories");
      } finally {
        setCatLoading(false);
      }
    }
    fetchCategories();
  }, []);

  // ── Load entries ────────────────────────────────────────────────────────────

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/entry", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch entries");
      const json = await res.json();
      setEntries(json.entries ?? []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchEntries();
    })();
  }, [fetchEntries]);

  // ── Restore targets and timer from localStorage ─────────────────────────────

  useEffect(() => {
    // Mount-time restore from localStorage; must stay out of render to avoid
    // an SSR hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(readTargets());

    const saved = localStorage.getItem(TIMER_STATE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (parsed.categoryId) setCategoryId(parsed.categoryId);

      const restored = restoreSegments(parsed);
      if (restored.length === 0) return;
      setSegments(restored);

      const lastOpen = restored[restored.length - 1].end === null;
      if (parsed.state === "running" && lastOpen) {
        setTimerState("running");
      } else if (parsed.state === "paused" && !lastOpen) {
        setTimerState("paused");
      } else if (!lastOpen) {
        setTimerState("stopped");
      } else {
        // An open segment with no running state can't be reconciled; close it
        // rather than leaving a timer that counts from an unknown moment.
        setSegments(restored.slice(0, -1));
        setTimerState(restored.length > 1 ? "stopped" : "idle");
      }
    } catch {
      localStorage.removeItem(TIMER_STATE_KEY);
    }
  }, []);

  // ── Tick ────────────────────────────────────────────────────────────────────

  // Elapsed is always recomputed from timestamps, so it stays correct across
  // sleep, throttled background tabs and clock changes. Sub-second polling
  // keeps the displayed second from visibly stuttering.
  useEffect(() => {
    // Recompute immediately on state changes so the displayed second doesn't
    // visibly stutter while waiting for the first interval tick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(totalSeconds(segments, Date.now()));
    if (timerState !== "running") return;
    const id = setInterval(
      () => setElapsed(totalSeconds(segments, Date.now())),
      500
    );
    return () => clearInterval(id);
  }, [timerState, segments]);

  // A minute of drift is invisible on a "finishes at 6:30 PM" label, so this
  // ticks far slower than the clock itself.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────────

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;

  // Every category gets a chip; the picker fills the row and pushes whatever
  // is left over into its "More" menu, so the order decides what stays visible.
  const orderedCategories = useMemo(() => {
    const cutoff = NOW - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      if (new Date(e.start_time).getTime() >= cutoff) {
        counts[e.category] = (counts[e.category] ?? 0) + 1;
      }
    });
    return [...categories].sort(
      (a, b) =>
        (counts[b.name] ?? 0) - (counts[a.name] ?? 0) ||
        a.name.localeCompare(b.name)
    );
  }, [entries, categories]);

  // Time already logged today for the selected category — the daily target
  // counts these alongside the session currently on screen.
  const loggedSecondsToday = useMemo(() => {
    if (!selectedCategory) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return entries
      .filter(
        (e) =>
          e.category === selectedCategory.name &&
          new Date(e.start_time) >= startOfDay
      )
      .reduce((acc, e) => acc + (e.duration_seconds ?? 0), 0);
  }, [entries, selectedCategory]);

  const target = selectedCategory ? targets[selectedCategory.name] : undefined;
  const doneToday = loggedSecondsToday + elapsed;
  const progress = target ? Math.min(1, doneToday / target) : 0;
  const targetMet = target != null && doneToday >= target;
  // Bare values: TimerDisplay pairs each with its own caption.
  const remainingLabel =
    target == null
      ? undefined
      : formatDuration(targetMet ? doneToday - target : target - doneToday);

  // When the target will be reached if tracking continues uninterrupted from
  // now — and, while the timer is stopped, if it were restarted right now.
  const etaLabel =
    target == null || targetMet || now == null
      ? undefined
      : formatEta(new Date(now + (target - doneToday) * 1000), new Date(now));

  const allClosed = segments.every((seg) => seg.end !== null);
  const allValid = segments.every(isSegmentValid);
  const isValid = !!selectedCategory && segments.length > 0 && allClosed && allValid;
  const canSubmitNow =
    (timerState === "stopped" || timerState === "idle") &&
    segments.length > 0 &&
    allClosed;

  // ── Persistence ─────────────────────────────────────────────────────────────

  const persist = useCallback(
    (state: TimerState, segs: Segment[], catId: number | null) => {
      saveTimerState({ state, segments: segs, categoryId: catId });
    },
    []
  );

  // ── Tab title ───────────────────────────────────────────────────────────────

  const baseTitleRef = useRef<string>("");
  useEffect(() => {
    baseTitleRef.current = document.title;
    return () => {
      document.title = baseTitleRef.current;
    };
  }, []);

  // The timer page usually sits in a background tab — surface the running
  // clock in the tab title so it's readable without switching to it.
  useEffect(() => {
    const base = baseTitleRef.current || "Timer";
    if (timerState === "idle" || timerState === "stopped") {
      document.title = base;
      return;
    }
    const { hm, ss } = splitClock(elapsed);
    const label = selectedCategory ? ` · ${selectedCategory.name}` : "";
    const suffix = timerState === "paused" ? " (paused)" : "";
    document.title = `${hm}:${ss}${label}${suffix}`;
  }, [timerState, elapsed, selectedCategory]);

  // ── Daily target reached ────────────────────────────────────────────────────

  // Only announce a crossing we actually watched happen, so reloading a day
  // that is already over target stays quiet.
  const wasBelowTargetRef = useRef(false);
  useEffect(() => {
    if (!target || !selectedCategory) return;
    if (doneToday < target) {
      wasBelowTargetRef.current = true;
      return;
    }
    if (timerState !== "running" || !wasBelowTargetRef.current) return;
    wasBelowTargetRef.current = false;
    playChime();
    notifyCompletion(
      "Daily target reached",
      `${formatDuration(doneToday)} logged for ${selectedCategory.name} today.`
    );
  }, [doneToday, target, timerState, selectedCategory]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (!categoryId) return;
    if (
      timerState === "stopped" &&
      segments.length > 0 &&
      !confirm("Discard the current unsubmitted session and start a new one?")
    ) {
      return;
    }
    const next: Segment[] = [{ start: new Date().toISOString(), end: null }];
    setSegments(next);
    setTimerState("running");
    setSubmitStatus("idle");
    setSubmitMessage(null);
    persist("running", next, categoryId);
    ensureNotificationPermission();
  }, [categoryId, timerState, segments.length, persist]);

  const handlePause = useCallback(() => {
    const next = segments.map((seg, i) =>
      i === segments.length - 1 && seg.end === null
        ? { ...seg, end: new Date().toISOString() }
        : seg
    );
    setSegments(next);
    setTimerState("paused");
    persist("paused", next, categoryId);
  }, [segments, categoryId, persist]);

  const handleResume = useCallback(() => {
    const next = [...segments, { start: new Date().toISOString(), end: null }];
    setSegments(next);
    setTimerState("running");
    persist("running", next, categoryId);
  }, [segments, categoryId, persist]);

  const handleStop = useCallback(() => {
    const now = new Date().toISOString();
    const next = segments.map((seg) =>
      seg.end === null ? { ...seg, end: now } : seg
    );
    setSegments(next);
    setTimerState("stopped");
    persist("stopped", next, categoryId);
  }, [segments, categoryId, persist]);

  function handleSegmentsChange(next: Segment[]) {
    setSegments(next);
    const state = next.length === 0 ? "idle" : timerState;
    if (next.length === 0) setTimerState("idle");
    persist(state, next, categoryId);
  }

  function handleSelectCategory(id: number | null) {
    setCategoryId(id);
    persist(timerState, segments, id);
  }

  function handleDiscard() {
    if (!confirm("Discard this session without saving?")) return;
    setSegments([]);
    setTimerState("idle");
    setElapsed(0);
    setSubmitStatus("idle");
    setSubmitMessage(null);
    persist("idle", [], categoryId);
  }

  function setTarget(seconds: number) {
    if (!selectedCategory) return;
    const next = { ...targets, [selectedCategory.name]: seconds };
    setTargets(next);
    writeTargets(next);
  }

  function clearTarget() {
    if (!selectedCategory) return;
    const next = { ...targets };
    delete next[selectedCategory.name];
    setTargets(next);
    writeTargets(next);
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing. Anything else — including a button that
      // still has focus from the last click — should reach the timer.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (timerState === "running") handlePause();
        else if (timerState === "paused") handleResume();
        else if (categoryId) handleStart();
      } else if (e.key.toLowerCase() === "s") {
        if (timerState === "running" || timerState === "paused") {
          e.preventDefault();
          handleStop();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [timerState, categoryId, handleStart, handlePause, handleResume, handleStop]);

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!isValid || !selectedCategory) return;
    setSubmitStatus("loading");
    setSubmitMessage(null);

    try {
      // A session interrupted by pauses is several real intervals, so it is
      // submitted as one entry per interval rather than one inflated block.
      if (segments.length === 1) {
        const res = await fetch("/api/entry/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            category: selectedCategory.name,
            start_time: segments[0].start,
            end_time: segments[0].end,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to create entry");
      } else {
        const res = await fetch("/api/entry/batch-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            entries: segments.map((seg) => ({
              category: selectedCategory.name,
              start_time: seg.start,
              end_time: seg.end,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to create entries");
        if (data.failed > 0) {
          throw new Error(
            `${data.success} of ${segments.length} intervals saved; ` +
              `${data.failed} failed. Check the times and try again.`
          );
        }
      }

      setSubmitStatus("success");
      setSubmitMessage(
        segments.length === 1
          ? "Entry submitted successfully!"
          : `${segments.length} intervals submitted successfully!`
      );

      // Reset — the category is kept so the daily target panel keeps tracking it
      setTimerState("idle");
      setSegments([]);
      setElapsed(0);
      persist("idle", [], categoryId);

      // Pull the entries we just created into today's totals
      fetchEntries();
    } catch (err) {
      setSubmitStatus("error");
      setSubmitMessage(err instanceof Error ? err.message : "Failed to submit entries");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-6xl mx-auto space-y-6 text-primary">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">
            Timer
          </h1>
          <p className="text-sm text-muted mt-1">
            Track your time by category
          </p>
        </div>
        <a
          href="/namu/user/entries"
          className="text-sm px-4 py-2 rounded-lg border border-default
                     bg-surface-raised hover:bg-surface-hover
                     transition-colors text-gray-700 dark:text-gray-200 font-medium"
        >
          View Entries
        </a>
      </div>

      {/* Main grid. On phones the wrappers collapse (display: contents) so the
          cards order as one column — the daily target has to come before the
          stats there, while desktop keeps it under Today's Activity. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Category, timer and session */}
        <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-6">
          {/* Category first: nothing can start without it */}
          <div className="order-1 lg:order-none bg-surface p-5 rounded-xl shadow-sm border border-subtle">
            <CategoryPicker
              categories={orderedCategories}
              selectedId={categoryId}
              onSelect={handleSelectCategory}
              loading={catLoading}
              error={catError}
              locked={timerState === "running" || timerState === "paused"}
            />
          </div>

          {/* Absorbs leftover height when the right column is the taller one,
              so the two columns always close into a rectangle. */}
          <div className="order-2 lg:order-none lg:flex-1 lg:min-h-0">
            <TimerDisplay
              elapsed={elapsed}
              state={timerState}
              onStart={handleStart}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              disabled={!categoryId}
              disabledReason="Select a category first"
              progress={progress}
              hasTarget={target != null}
              targetMet={targetMet}
              remainingLabel={remainingLabel}
              etaLabel={etaLabel}
            />
          </div>

          {/* Session details + submit */}
          <div className="order-3 lg:order-none bg-surface p-5 rounded-xl shadow-sm border border-subtle space-y-4">
            <SessionSegments
              segments={segments}
              onChange={handleSegmentsChange}
              state={timerState}
            />

            {canSubmitNow && (
              <div className="space-y-3 border-t border-subtle pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">
                    Session total
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatDuration(elapsed)}
                  </span>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={!isValid || submitStatus === "loading"}
                    className="flex-1 py-3.5 rounded-xl font-semibold text-white text-lg transition active:scale-95
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
                  <button
                    onClick={handleDiscard}
                    disabled={submitStatus === "loading"}
                    className="px-4 py-3.5 rounded-xl text-sm text-secondary
                               border border-default
                               hover:bg-surface-inset transition-colors
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Discard
                  </button>
                </div>

                {/* Validation hints */}
                {!isValid && (
                  <ul className="text-xs text-dim space-y-1">
                    {!selectedCategory && (
                      <li className="flex items-center gap-1.5">
                        <span className="w-1 h-1 bg-gray-400 rounded-full" />
                        Select a category
                      </li>
                    )}
                    {!allValid && (
                      <li className="flex items-center gap-1.5">
                        <span className="w-1 h-1 bg-gray-400 rounded-full" />
                        Every interval needs an end after its start
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {/* Feedback */}
            {submitMessage && (
              <div
                className={`p-3 rounded-lg text-sm ${
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

        {/* Right Column - Stats */}
        <div className="contents lg:flex lg:flex-col lg:gap-6">
          <div className="order-5 lg:order-none">
            <QuickStats entries={entries} loading={entriesLoading} />
          </div>

          {/* Daily target for the selected category */}
          {selectedCategory && (
            <div className="order-4 lg:order-none">
              <DailyTarget
                categoryName={selectedCategory.name}
                target={target}
                onSetTarget={setTarget}
                onClearTarget={clearTarget}
                loggedSeconds={loggedSecondsToday}
                liveSeconds={elapsed}
                loading={entriesLoading}
              />
            </div>
          )}

          {/* Takes up whatever height the left column leaves over, so the two
              columns end flush instead of leaving a gap at the bottom right. */}
          <div className="order-6 lg:order-none lg:flex-1 lg:min-h-0 max-h-80 lg:max-h-none">
            <TodaySessions
              entries={entries}
              activeCategory={selectedCategory?.name ?? null}
              loading={entriesLoading}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
