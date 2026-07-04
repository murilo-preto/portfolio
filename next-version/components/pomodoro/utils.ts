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

/** Plays a short two-tone chime via the Web Audio API (no bundled asset needed). */
export function playChime() {
  try {
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtxCtor) return;
    const ctx = new AudioCtxCtor();
    const now = ctx.currentTime;
    [880, 1108].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Autoplay policy or unsupported browser — silently skip the chime.
  }
}

export function notifyCompletion(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export async function ensureNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // ignore — falls back to audio-only feedback
    }
  }
}
