import type { PomodoroSettings } from "@/lib/types";

export type TimerMode = "pomodoro" | "shortBreak" | "longBreak";
export type TimerRunState = "idle" | "running" | "paused";

export const DEFAULT_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
};

export const SETTINGS_STORAGE_KEY = "pomodoroSettings";
export const STATE_STORAGE_KEY = "pomodoroState";

export function getDurationSeconds(
  mode: TimerMode,
  settings: PomodoroSettings
): number {
  switch (mode) {
    case "pomodoro":
      return settings.workMinutes * 60;
    case "shortBreak":
      return settings.shortBreakMinutes * 60;
    case "longBreak":
      return settings.longBreakMinutes * 60;
  }
}

export function modeToSessionType(
  mode: TimerMode
): "pomodoro" | "short_break" | "long_break" {
  if (mode === "pomodoro") return "pomodoro";
  if (mode === "shortBreak") return "short_break";
  return "long_break";
}

export function modeLabel(mode: TimerMode): string {
  switch (mode) {
    case "pomodoro":
      return "Pomodoro";
    case "shortBreak":
      return "Short Break";
    case "longBreak":
      return "Long Break";
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function loadSettings(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PomodoroSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — the
    // settings just won't persist across reloads, which is a safe fallback.
  }
}

// Notification/chime helpers now live in lib/notifications.ts so the stopwatch
// can share them; re-exported here for existing Pomodoro call sites.
export {
  playChime,
  notifyCompletion,
  ensureNotificationPermission,
} from "@/lib/notifications";
