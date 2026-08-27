"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatPriceIn, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { applyCurrency } from "@/lib/use-currency";
import {
  applyTheme,
  changePassword,
  DEFAULT_PREFERENCE_SETTINGS,
  fetchPreferences,
  MIN_PASSWORD_LENGTH,
  readStoredTheme,
  savePreferences,
  THEME_OPTIONS,
} from "@/lib/preferences";
import type {
  PomodoroPreferences,
  ThemePreference,
  UserPreferences,
} from "@/lib/preferences";

// ─── Types ───────────────────────────────────────────────────────────────────

type Pending = "password" | "reset" | null;

type Feedback = { kind: "success" | "error"; message: string } | null;

const PREVIEW_AMOUNT = 1234.56;

const POMODORO_FIELDS: readonly {
  key: keyof PomodoroPreferences;
  label: string;
}[] = [
  { key: "workMinutes", label: "Pomodoro (minutes)" },
  { key: "shortBreakMinutes", label: "Short break (minutes)" },
  { key: "longBreakMinutes", label: "Long break (minutes)" },
  { key: "sessionsBeforeLongBreak", label: "Sessions before long break" },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Draft copies of the controls that save on a button rather than on change.
  const [currency, setCurrency] = useState("BRL");
  const [pomodoro, setPomodoro] = useState<PomodoroPreferences>(
    DEFAULT_PREFERENCE_SETTINGS.pomodoro,
  );
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsFeedback, setPrefsFeedback] = useState<Feedback>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);

  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    // The stored theme is applied before the round trip so the page does not
    // flash the OS theme on every load; the server answer overrides it below.
    applyTheme(readStoredTheme());

    async function load() {
      try {
        const data = await fetchPreferences();
        setPrefs(data);
        setCurrency(data.currency);
        setPomodoro(data.settings.pomodoro);
        applyTheme(data.theme);
        applyCurrency(data.currency);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load preferences",
        );
      }
    }
    load();
  }, []);

  async function handleThemeChange(theme: ThemePreference) {
    // Applied before the request so the click feels instant; a failed save
    // leaves the page looking right but says so, and the next load reverts it.
    applyTheme(theme);
    setPrefs((current) => (current ? { ...current, theme } : current));
    setPrefsFeedback(null);

    try {
      await savePreferences({ theme });
    } catch (err: unknown) {
      setPrefsFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to save theme",
      });
    }
  }

  function updatePomodoro(key: keyof PomodoroPreferences, raw: string) {
    const value = parseInt(raw, 10);
    if (Number.isNaN(value) || value <= 0) return;
    setPomodoro((current) => ({ ...current, [key]: value }));
  }

  async function handleSavePreferences() {
    setSavingPrefs(true);
    setPrefsFeedback(null);
    try {
      const saved = await savePreferences({ currency, settings: { pomodoro } });
      setPrefs(saved);
      setCurrency(saved.currency);
      setPomodoro(saved.settings.pomodoro);
      applyCurrency(saved.currency);
      setPrefsFeedback({ kind: "success", message: "Preferences saved" });
    } catch (err: unknown) {
      setPrefsFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to save preferences",
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleResetPreferences() {
    setPending(null);
    setSavingPrefs(true);
    setPrefsFeedback(null);
    try {
      const saved = await savePreferences({
        theme: "system",
        currency: "BRL",
        settings: DEFAULT_PREFERENCE_SETTINGS,
      });
      setPrefs(saved);
      setCurrency(saved.currency);
      setPomodoro(saved.settings.pomodoro);
      applyTheme(saved.theme);
      applyCurrency(saved.currency);
      setPrefsFeedback({ kind: "success", message: "Preferences reset" });
    } catch (err: unknown) {
      setPrefsFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to reset preferences",
      });
    } finally {
      setSavingPrefs(false);
    }
  }

  /** Client-side password checks, so the obvious mistakes cost no round trip. */
  function validatePassword(): string | null {
    if (!currentPassword) return "Enter your current password";
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return `New password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    if (newPassword === currentPassword) {
      return "New password must be different from the current password";
    }
    if (newPassword !== confirmPassword) return "The new passwords do not match";
    return null;
  }

  function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validatePassword();
    if (problem) {
      setPasswordFeedback({ kind: "error", message: problem });
      return;
    }
    setPasswordFeedback(null);
    setPending("password");
  }

  async function handlePasswordConfirm() {
    setPending(null);
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordFeedback({ kind: "success", message: "Password updated" });
    } catch (err: unknown) {
      setPasswordFeedback({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to change password",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  const theme = prefs?.theme ?? "system";

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-3xl mx-auto space-y-6 text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-primary">Settings</h1>
        <p className="text-sm text-muted mt-1">
          Your account and the preferences that follow you between devices
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg border border-tint-red-line bg-tint-red-a px-4 py-3 text-sm text-primary">
          {loadError}
        </p>
      )}

      {/* ── Account ───────────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl shadow-sm border border-subtle p-5 space-y-3">
        <h2 className="text-sm font-semibold text-primary">Account</h2>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-xs text-muted">Username</span>
          <span className="text-sm font-medium text-primary">
            {prefs ? prefs.username : "…"}
          </span>
        </div>
        <p className="text-xs text-dim">
          Usernames are permanent: every access token and every ownership check
          identifies you by this name, so renaming would sign you out and orphan
          your entries.
        </p>
      </section>

      {/* ── Password ──────────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl shadow-sm border border-subtle p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-primary">Change password</h2>
          <p className="text-xs text-dim mt-1">
            Your current password is required. Sessions already signed in stay
            signed in until their token expires.
          </p>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-3">
          <PasswordField
            label="Current password"
            value={currentPassword}
            autoComplete="current-password"
            onChange={setCurrentPassword}
          />
          <PasswordField
            label="New password"
            value={newPassword}
            autoComplete="new-password"
            onChange={setNewPassword}
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            autoComplete="new-password"
            onChange={setConfirmPassword}
          />

          {passwordFeedback && <FeedbackNote feedback={passwordFeedback} />}

          <button
            type="submit"
            disabled={savingPassword}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-invert text-invert-fg
                       hover:bg-invert-hover transition-colors disabled:opacity-50"
          >
            {savingPassword ? "Updating…" : "Change password"}
          </button>
        </form>
      </section>

      {/* ── Preferences ───────────────────────────────────────────────── */}
      <section className="bg-surface rounded-xl shadow-sm border border-subtle p-5 space-y-5">
        <h2 className="text-sm font-semibold text-primary">Preferences</h2>

        <div className="space-y-2">
          <span className="text-xs text-muted">Theme</span>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                onClick={() => handleThemeChange(option.value)}
                aria-pressed={theme === option.value}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  theme === option.value
                    ? "border-strong bg-surface-inset text-primary"
                    : "border-subtle bg-surface-raised text-secondary hover:bg-surface-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-dim">
            Applies here right away; other pages pick it up on their next load.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="currency"
            className="text-xs text-muted block"
          >
            Currency
          </label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full sm:w-64 px-3 py-2 rounded-lg border border-strong bg-surface-raised
                       text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
          >
            {Object.entries(SUPPORTED_CURRENCIES).map(([code, meta]) => (
              <option key={code} value={code}>
                {code} — {meta.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-dim">
            Amounts read as {formatPriceIn(PREVIEW_AMOUNT, currency)} everywhere
            once saved. This changes how stored amounts are displayed; it does
            not convert them.
          </p>
        </div>

        <div className="space-y-2">
          <span className="text-xs text-muted">Pomodoro durations</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {POMODORO_FIELDS.map((field) => (
              <NumberField
                key={field.key}
                label={field.label}
                value={pomodoro[field.key]}
                onChange={(raw) => updatePomodoro(field.key, raw)}
              />
            ))}
          </div>
        </div>

        {prefsFeedback && <FeedbackNote feedback={prefsFeedback} />}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSavePreferences}
            disabled={savingPrefs || !prefs}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-invert text-invert-fg
                       hover:bg-invert-hover transition-colors disabled:opacity-50"
          >
            {savingPrefs ? "Saving…" : "Save preferences"}
          </button>
          <button
            type="button"
            onClick={() => setPending("reset")}
            disabled={savingPrefs || !prefs}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-muted text-secondary
                       hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            Reset to defaults
          </button>
        </div>
      </section>

      <ConfirmDialog
        isOpen={pending === "password"}
        title="Change password?"
        message="You will need the new password the next time you sign in. Sessions already signed in are not signed out."
        confirmLabel="Change password"
        onConfirm={handlePasswordConfirm}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        isOpen={pending === "reset"}
        title="Reset preferences?"
        message="Theme, currency, pomodoro durations, daily targets and saved To Do filters all go back to their defaults. This cannot be undone."
        confirmLabel="Reset"
        onConfirm={handleResetPreferences}
        onCancel={() => setPending(null)}
      />
    </main>
  );
}

// ─── Fields ──────────────────────────────────────────────────────────────────

function FeedbackNote({ feedback }: { feedback: NonNullable<Feedback> }) {
  const tone =
    feedback.kind === "error"
      ? "border-tint-red-line bg-tint-red-a"
      : "border-tint-green-line bg-tint-green-a";
  return (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm text-primary ${tone}`}
    >
      {feedback.message}
    </p>
  );
}

function PasswordField({
  label,
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  value: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-72 px-3 py-2 rounded-lg border border-strong bg-surface-raised
                   text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 px-2 py-1.5 rounded-lg border border-strong bg-surface-raised
                   text-sm text-right focus:outline-none focus:ring-2 focus:ring-neutral-400"
      />
    </label>
  );
}
