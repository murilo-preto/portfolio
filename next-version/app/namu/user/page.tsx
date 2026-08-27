"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Panel } from "@/components/entries/Panel";
import { EmptyState } from "@/components/entries/EmptyState";
import { SummaryCard } from "@/components/finance/SummaryCard";
import { PriorityBadge } from "@/components/todo/PriorityBadge";
import { StatusBadge } from "@/components/todo/StatusBadge";
import { PrefetchLink } from "@/components/PrefetchLink";
import { formatDuration } from "@/components/entries/utils";
import { formatDateTime, isOverdue } from "@/components/todo/utils";
import { normalizeCategoryName } from "@/lib/categoryName";
import { useCurrency } from "@/lib/use-currency";
import { warmFetch } from "@/lib/prefetch";
import type { ApiResponse as EntriesResponse } from "@/components/entries/types";
import type {
  ApiResponse as FinanceResponse,
  FinanceEntry,
} from "@/components/finance/types";
import type {
  PomodoroSessionsResponse,
  PomodoroStats,
  TodoApiResponse,
  TodoItem,
} from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** How many rows each panel shows before deferring to its full page. */
const RECENT_ENTRIES = 5;
const OPEN_TASKS = 6;
const RECENT_PURCHASES = 5;
const TODAY_SESSIONS = 5;

// ─── Data loading ────────────────────────────────────────────────────────────

type Resource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/**
 * One `/api` GET with its own loading/error state and a `reload` the UI can
 * offer as a retry. The dashboard reads five endpoints and a failure in any
 * one of them must not blank the other four, so each gets its own resource
 * rather than a single all-or-nothing fetch.
 */
function useResource<T>(url: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await warmFetch(url, { credentials: "include" });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Failed to load data");
      }

      setData(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [url]);

  // Putting the state reset here rather than at the top of `load` keeps the
  // mount effect free of a synchronous setState, which would cascade a render.
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  return { data, loading, error, reload };
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─── Shared UI primitives ────────────────────────────────────────────────────

/**
 * Renders a panel body from a resource: the spinner-free loading line, the
 * error *with a way out of it*, or the children. Every fetch on this page goes
 * through here so no failure is left as a dead end.
 */
function ResourceBody<T>({
  resource,
  children,
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
}) {
  if (resource.loading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (resource.error) {
    return (
      <div className="flex flex-col items-start gap-2 py-2">
        <p className="text-sm text-red-500">{resource.error}</p>
        <button
          type="button"
          onClick={resource.reload}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors active:scale-95"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!resource.data) return null;

  return <>{children(resource.data)}</>;
}

/** The headline number for a resource that may not have arrived yet. The
 *  matching panel below carries the retry, so a card only has to say that the
 *  number is missing — never swallow the failure silently. */
function cardValue<T>(
  resource: Resource<T>,
  value: (data: T) => string | number,
) {
  if (resource.loading) return "…";
  if (resource.error || !resource.data) return "—";
  return value(resource.data);
}

function cardSubtitle<T>(
  resource: Resource<T>,
  subtitle: (data: T) => string,
) {
  if (resource.loading) return "Loading…";
  if (resource.error || !resource.data) return "Couldn't load — retry below";
  return subtitle(resource.data);
}

function QuickAction({
  href,
  label,
  description,
  icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <PrefetchLink
      href={href}
      className="flex items-center gap-3 p-3 rounded-xl border border-default bg-surface hover:border-strong hover:bg-surface-hover transition-colors active:scale-[0.99]"
    >
      <span className="p-2 rounded-lg bg-surface-inset text-secondary flex-none">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-primary truncate">
          {label}
        </span>
        <span className="block text-xs text-muted truncate">{description}</span>
      </span>
    </PrefetchLink>
  );
}

/** "View all →" for a panel header, kept identical across the page. */
function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <PrefetchLink
      href={href}
      className="text-xs font-medium text-muted hover:text-primary transition-colors whitespace-nowrap"
    >
      {label} →
    </PrefetchLink>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { formatPrice } = useCurrency();
  const entries = useResource<EntriesResponse>("/api/entry");
  const todos = useResource<TodoApiResponse>("/api/todo");
  const finance = useResource<FinanceResponse>("/api/finance");
  const pomodoro = useResource<PomodoroStats>("/api/pomodoro/stats");
  const sessions = useResource<PomodoroSessionsResponse>(
    "/api/pomodoro/sessions",
  );

  // ── Today's time ──
  const time = useMemo(() => {
    const dayStart = startOfToday();
    const today = (entries.data?.entries ?? [])
      .filter((e) => new Date(e.start_time) >= dayStart)
      .sort(
        (a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
      );

    const totalSeconds = today.reduce((acc, e) => acc + e.duration_seconds, 0);

    const byCategory = new Map<string, number>();
    for (const entry of today) {
      byCategory.set(
        entry.category,
        (byCategory.get(entry.category) ?? 0) + entry.duration_seconds,
      );
    }

    return {
      today,
      totalSeconds,
      categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [entries.data]);

  // ── Tasks ──
  const tasks = useMemo(() => {
    const items = todos.data?.items ?? [];
    const open = items.filter((i) => i.status !== "completed");
    const overdue = open.filter((i) => isOverdue(i.due_date, i.status));
    const dueToday = open.filter(
      (i) =>
        !!i.due_date &&
        !isOverdue(i.due_date, i.status) &&
        isSameDay(new Date(i.due_date), new Date()),
    );

    // Overdue first, then whatever is due soonest; undated work sinks to the
    // bottom, where a priority tie-break keeps the list meaningful.
    const rank = (item: TodoItem) => {
      if (isOverdue(item.due_date, item.status)) return 0;
      if (item.due_date) return 1;
      return 2;
    };
    const priorityRank = { high: 0, medium: 1, low: 2 };

    const sorted = [...open].sort((a, b) => {
      const byBucket = rank(a) - rank(b);
      if (byBucket !== 0) return byBucket;
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      return priorityRank[a.priority] - priorityRank[b.priority];
    });

    return { open, overdue, dueToday, sorted };
  }, [todos.data]);

  // ── Money ──
  const money = useMemo(() => {
    const dayStart = startOfToday();
    const monthStart = startOfMonth();
    const all = finance.data?.entries ?? [];

    const sum = (list: FinanceEntry[]) =>
      list.reduce((acc, e) => acc + Number(e.price), 0);

    const inMonth = all.filter(
      (e) => new Date(e.purchase_date) >= monthStart,
    );
    const today = all.filter((e) => new Date(e.purchase_date) >= dayStart);

    return {
      today,
      todayTotal: sum(today),
      monthTotal: sum(inMonth),
      monthPlanned: sum(inMonth.filter((e) => e.status === "planned")),
      recent: [...all]
        .sort(
          (a, b) =>
            new Date(b.purchase_date).getTime() -
            new Date(a.purchase_date).getTime(),
        )
        .slice(0, RECENT_PURCHASES),
    };
  }, [finance.data]);

  // ── Focus ──
  const todaySessions = useMemo(() => {
    const now = new Date();
    return (sessions.data?.sessions ?? [])
      .filter(
        (s) =>
          s.session_type === "pomodoro" &&
          s.status === "completed" &&
          isSameDay(new Date(s.session_date), now),
      )
      .slice(0, TODAY_SESSIONS);
  }, [sessions.data]);

  const username =
    entries.data?.username ??
    finance.data?.username ??
    todos.data?.username ??
    null;

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-primary">
          {username ? `${username}'s day` : "Today"}
        </h1>
        <p className="text-sm text-muted mt-1">{todayLabel}</p>
      </div>

      {/* Quick actions — the four things a day usually starts with */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickAction
          href="/namu/user/timer"
          label="Start stopwatch"
          description="Time what you're doing now"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <QuickAction
          href="/namu/user/todo"
          label="Add a task"
          description="Capture it before it's lost"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
        />
        <QuickAction
          href="/namu/user/finance/manage"
          label="Log an expense"
          description="Record what you spent"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <QuickAction
          href="/namu/user/manage"
          label="Manage entries"
          description="Add or fix a time entry"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
        />
      </div>

      {/* Headline metrics — one card per domain, each stated once */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Time Logged"
          value={cardValue(entries, () => formatDuration(time.totalSeconds))}
          subtitle={cardSubtitle(entries, () =>
            time.today.length === 1 ? "1 session today" : `${time.today.length} sessions today`,
          )}
          accentColor="blue"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Focus Sessions"
          value={cardValue(pomodoro, (data) => data.stats.today.sessions)}
          subtitle={cardSubtitle(
            pomodoro,
            (data) => `${formatDuration(data.stats.today.total_seconds)} focused`,
          )}
          accentColor="purple"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3M3.05 11a9 9 0 1118 2 9 9 0 01-18-2z" />
            </svg>
          }
        />
        <SummaryCard
          title="Open Tasks"
          value={cardValue(todos, () => tasks.open.length)}
          subtitle={cardSubtitle(todos, () =>
            tasks.overdue.length > 0
              ? `${tasks.overdue.length} overdue`
              : tasks.dueToday.length > 0
                ? `${tasks.dueToday.length} due today`
                : "Nothing overdue",
          )}
          accentColor="amber"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <SummaryCard
          title="Spent Today"
          value={cardValue(finance, () => formatPrice(money.todayTotal))}
          subtitle={cardSubtitle(
            finance,
            () => `${formatPrice(money.monthTotal)} this month`,
          )}
          accentColor="green"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
      </div>

      {/* Time + focus */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Panel
          title="Today's Time"
          action={<PanelLink href="/namu/user/entries" label="All entries" />}
          className="lg:col-span-2"
        >
          <ResourceBody resource={entries}>
            {() =>
              time.today.length === 0 ? (
                <EmptyState message="Nothing logged yet today — start the stopwatch and it will show up here." />
              ) : (
                <div className="space-y-5">
                  {/* Where the day went, proportional to the whole */}
                  <ul className="space-y-2">
                    {time.categories.map(([category, seconds]) => {
                      const share = Math.round(
                        (seconds / time.totalSeconds) * 100,
                      );
                      return (
                        <li key={category} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate text-secondary">
                              {category}
                            </span>
                            <span className="flex-none tabular-nums font-medium text-primary">
                              {formatDuration(seconds)}
                              <span className="ml-2 text-xs text-dim">
                                {share}%
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-inset overflow-hidden">
                            <div
                              className="h-full rounded-full bg-tint-blue-ink"
                              style={{ width: `${Math.max(share, 2)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {/* The notes are the point: what was actually done */}
                  <div className="pt-4 border-t border-subtle">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
                      Latest sessions
                    </p>
                    <ul className="divide-y divide-subtle">
                      {time.today.slice(0, RECENT_ENTRIES).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-start justify-between gap-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary truncate">
                              {entry.category}
                            </p>
                            {entry.note && (
                              <p className="text-xs text-secondary break-words">
                                {entry.note}
                              </p>
                            )}
                            <p className="text-xs text-dim tabular-nums">
                              {clockTime(entry.start_time)} –{" "}
                              {clockTime(entry.end_time)}
                            </p>
                          </div>
                          <span className="flex-none text-sm tabular-nums text-secondary">
                            {formatDuration(entry.duration_seconds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            }
          </ResourceBody>
        </Panel>

        <Panel
          title="Focus"
          action={<PanelLink href="/namu/user/pomodoro" label="Pomodoro" />}
        >
          <div className="space-y-4">
            <ResourceBody resource={pomodoro}>
              {(stats) => (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-gradient-to-br from-tint-red-a to-tint-red-b border border-tint-red-line">
                    <p className="text-xs text-muted">Today (focus)</p>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-lg font-bold text-primary">
                        {stats.stats.today.sessions} sessions
                      </p>
                      <p className="text-sm font-medium text-red-500 tabular-nums">
                        {formatDuration(stats.stats.today.total_seconds)}
                      </p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-inset">
                    <p className="text-xs text-muted">Today (breaks)</p>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-primary">
                        {stats.stats.today_breaks.sessions} sessions
                      </p>
                      <p className="text-sm font-medium text-muted tabular-nums">
                        {formatDuration(stats.stats.today_breaks.total_seconds)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </ResourceBody>

            {/* What each of those sessions was spent on */}
            <div className="pt-3 border-t border-subtle">
              <ResourceBody resource={sessions}>
                {() =>
                  todaySessions.length === 0 ? (
                    <p className="text-xs text-dim">
                      No completed focus sessions today.
                    </p>
                  ) : (
                    <ul className="divide-y divide-subtle">
                      {todaySessions.map((session) => (
                        <li
                          key={session.id}
                          className="flex items-center justify-between gap-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-secondary">
                              {session.todo_title ?? "Unassigned"}
                            </p>
                            <p className="text-dim tabular-nums">
                              {clockTime(session.session_date)}
                            </p>
                          </div>
                          <span className="flex-none tabular-nums text-secondary">
                            {formatDuration(session.duration_seconds)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </ResourceBody>
            </div>
          </div>
        </Panel>
      </div>

      {/* Tasks + money */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <Panel
          title="Open Tasks"
          action={<PanelLink href="/namu/user/todo" label="All tasks" />}
          className="lg:col-span-2"
        >
          <ResourceBody resource={todos}>
            {() =>
              tasks.open.length === 0 ? (
                <EmptyState message="Nothing open. Add a task to plan the rest of your day." />
              ) : (
                <ul className="space-y-2">
                  {tasks.sorted.slice(0, OPEN_TASKS).map((item) => {
                    const overdue = isOverdue(item.due_date, item.status);
                    return (
                      <li
                        key={item.id}
                        className={`p-3 rounded-lg border ${
                          overdue
                            ? "border-red-300 dark:border-red-700 bg-gradient-to-br from-tint-red-a to-tint-red-b"
                            : "border-subtle bg-surface-inset"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary truncate">
                              {item.title}
                            </p>
                            <p className="text-xs text-muted truncate">
                              {normalizeCategoryName(item.category)}
                            </p>
                          </div>
                          <div className="flex flex-none items-center gap-2">
                            <PriorityBadge priority={item.priority} />
                            <StatusBadge status={item.status} />
                          </div>
                        </div>
                        {item.due_date && (
                          <p
                            className={`text-xs mt-1 tabular-nums ${
                              overdue ? "text-red-500 font-medium" : "text-dim"
                            }`}
                          >
                            {overdue ? "Overdue — due " : "Due "}
                            {formatDateTime(item.due_date)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {tasks.open.length > OPEN_TASKS && (
                    <li className="text-xs text-dim pt-1">
                      +{tasks.open.length - OPEN_TASKS} more open
                    </li>
                  )}
                </ul>
              )
            }
          </ResourceBody>
        </Panel>

        <Panel
          title="Spending"
          action={<PanelLink href="/namu/user/finance" label="Finance" />}
        >
          <ResourceBody resource={finance}>
            {(data) =>
              data.entries.length === 0 ? (
                <EmptyState message="No expenses recorded yet." />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-surface-inset">
                      <p className="text-xs text-muted">Today</p>
                      <p className="text-lg font-semibold text-primary truncate">
                        {formatPrice(money.todayTotal)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-surface-inset">
                      <p className="text-xs text-muted">This month</p>
                      <p className="text-lg font-semibold text-primary truncate">
                        {formatPrice(money.monthTotal)}
                      </p>
                    </div>
                  </div>

                  {money.monthPlanned > 0 && (
                    <p className="text-xs text-dim">
                      {formatPrice(money.monthPlanned)} of this month is still
                      planned rather than spent.
                    </p>
                  )}

                  <div className="pt-3 border-t border-subtle">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">
                      Latest purchases
                    </p>
                    <ul className="divide-y divide-subtle">
                      {money.recent.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-secondary">
                              {entry.product_name}
                            </p>
                            <p className="text-dim truncate">
                              {normalizeCategoryName(entry.category)}
                            </p>
                          </div>
                          <span className="flex-none tabular-nums text-primary font-medium">
                            {formatPrice(Number(entry.price))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            }
          </ResourceBody>
        </Panel>
      </div>
    </main>
  );
}
