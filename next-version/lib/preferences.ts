/**
 * Account preferences — the server-backed replacement for the settings that
 * used to live only in `localStorage` (`timerDailyTargets`, `pomodoroSettings`,
 * `todoFilters`, last-used category/priority) and therefore never followed a
 * user to a second device.
 *
 * Flask owns the defaults (`DEFAULT_PREFERENCE_SETTINGS` in `app.py`) and fills
 * in every key on a read, so a response is always complete; the copies here are
 * only what the UI renders before the first fetch resolves.
 *
 * Types live in this file rather than `lib/types.ts` deliberately — they are
 * consumed by the settings page and the helpers below and nothing else yet.
 */

export type ThemePreference = "system" | "light" | "dark";

export const THEME_OPTIONS: readonly {
  value: ThemePreference;
  label: string;
  hint: string;
}[] = [
  { value: "system", label: "System", hint: "Follow the operating system" },
  { value: "light", label: "Light", hint: "Always the warm paper theme" },
  { value: "dark", label: "Dark", hint: "Always the dark theme" },
];

/**
 * A style within each mode, picked separately so "System" switches between
 * the two the user chose. Light has only Paper for now, so settings shows no
 * light picker; the slot exists so a second light style needs no change to
 * the stored shape.
 */
export type LightStyle = "paper";
export type DarkStyle = "default" | "oled" | "glass";
export type ThemeStyles = { light: LightStyle; dark: DarkStyle };

export const DARK_STYLE_OPTIONS: readonly {
  value: DarkStyle;
  label: string;
  hint: string;
}[] = [
  { value: "default", label: "Default", hint: "Neutral greys" },
  { value: "oled", label: "OLED", hint: "True black, separated by borders" },
  { value: "glass", label: "Glass", hint: "Monochrome, frosted menus and modals" },
];

export type PomodoroPreferences = {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
};

export type FocusPreferences = {
  /** Whether a finished focus session is also written to the time log. */
  logToTimeEntries: boolean;
  /** The time category those entries land in. Null until one is chosen. */
  category: string | null;
};

export type PreferenceSettings = {
  /** Daily target seconds, keyed by category name. */
  timerDailyTargets: Record<string, number>;
  pomodoro: PomodoroPreferences;
  todoFilters: Record<string, unknown>;
  lastUsed: { category: string | null; priority: string | null };
  focus: FocusPreferences;
  themeStyles: ThemeStyles;
};

export type UserPreferences = {
  username: string;
  theme: ThemePreference;
  currency: string;
  settings: PreferenceSettings;
};

/** A partial update — the API merges what is sent and leaves the rest alone. */
export type PreferencesPatch = {
  theme?: ThemePreference;
  currency?: string;
  settings?: Partial<PreferenceSettings>;
};

export const DEFAULT_PREFERENCE_SETTINGS: PreferenceSettings = {
  timerDailyTargets: {},
  pomodoro: {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
  },
  todoFilters: {},
  lastUsed: { category: null, priority: null },
  focus: { logToTimeEntries: false, category: null },
  themeStyles: { light: "paper", dark: "default" },
};

/**
 * Mirrored so a page can paint the right theme on first frame, before the
 * `/api/user/preferences` round trip resolves. The server row stays the source
 * of truth; this is a cache, and a stale one only costs a flash.
 */
export const THEME_STORAGE_KEY = "themePreference";

/**
 * Apply a theme to the document. `system` clears the attribute so the
 * `prefers-color-scheme` block in `globals.css` takes over again.
 */
export function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — the
    // theme still applies, it just cannot be restored before the next fetch.
  }
}

/**
 * Mirrored for the same first-frame reason as the theme. There is no light
 * counterpart yet: with one light style there is nothing to restore.
 */
export const THEME_DARK_STYLE_STORAGE_KEY = "themeDarkStyle";

/**
 * Narrow an untrusted value to a known dark style. The settings blob is
 * client-owned and unvalidated by Flask, so a stale or hand-edited value must
 * fall back to the default rather than name a style no CSS matches.
 */
export function parseDarkStyle(raw: unknown): DarkStyle {
  return raw === "oled" || raw === "glass" ? raw : "default";
}

/**
 * Apply the per-mode styles. The attribute is set regardless of the current
 * mode; `globals.css` only honours it while dark applies.
 */
export function applyThemeStyles(styles: Partial<ThemeStyles> | undefined) {
  if (typeof document === "undefined") return;

  const dark = parseDarkStyle(styles?.dark);
  const root = document.documentElement;
  if (dark === "default") {
    delete root.dataset.darkStyle;
  } else {
    root.dataset.darkStyle = dark;
  }

  try {
    localStorage.setItem(THEME_DARK_STYLE_STORAGE_KEY, dark);
  } catch {
    // Same as applyTheme: the style applies, it just is not mirrored.
  }
}

export function readStoredThemeStyles(): ThemeStyles {
  let dark: DarkStyle = "default";
  try {
    dark = parseDarkStyle(localStorage.getItem(THEME_DARK_STYLE_STORAGE_KEY));
  } catch {
    // Unreadable storage is indistinguishable from "never set one".
  }
  return { light: "paper", dark };
}

export function readStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Unreadable storage is indistinguishable from "never set one".
  }
  return "system";
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    // Non-JSON body (a proxy error page, an empty 502) — use the fallback.
  }
  return fallback;
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const res = await fetch("/api/user/preferences", { credentials: "include" });
  if (!res.ok) {
    throw new Error(await errorFrom(res, "Failed to load preferences"));
  }
  return res.json();
}

export async function savePreferences(
  patch: PreferencesPatch,
): Promise<UserPreferences> {
  const res = await fetch("/api/user/preferences", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(await errorFrom(res, "Failed to save preferences"));
  }
  return res.json();
}

export const MIN_PASSWORD_LENGTH = 6;

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch("/api/user/password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    throw new Error(await errorFrom(res, "Failed to change password"));
  }
}
