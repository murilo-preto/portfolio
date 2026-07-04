"use client";

import { useState } from "react";
import type { PomodoroSettings as PomodoroSettingsType } from "@/lib/types";

type PomodoroSettingsProps = {
  settings: PomodoroSettingsType;
  onChange: (settings: PomodoroSettingsType) => void;
};

export function PomodoroSettings({ settings, onChange }: PomodoroSettingsProps) {
  const [open, setOpen] = useState(false);

  function updateField(field: keyof PomodoroSettingsType, value: number) {
    if (Number.isNaN(value) || value <= 0) return;
    onChange({ ...settings, [field]: value });
  }

  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-sm border border-gray-200 dark:border-neutral-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-sm font-semibold text-gray-900 dark:text-gray-100"
      >
        Settings
        <span className="text-gray-400 text-xs">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <SettingField
            label="Pomodoro (minutes)"
            value={settings.workMinutes}
            onChange={(v) => updateField("workMinutes", v)}
          />
          <SettingField
            label="Short break (minutes)"
            value={settings.shortBreakMinutes}
            onChange={(v) => updateField("shortBreakMinutes", v)}
          />
          <SettingField
            label="Long break (minutes)"
            value={settings.longBreakMinutes}
            onChange={(v) => updateField("longBreakMinutes", v)}
          />
          <SettingField
            label="Sessions before long break"
            value={settings.sessionsBeforeLongBreak}
            onChange={(v) => updateField("sessionsBeforeLongBreak", v)}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Changes apply the next time you start or switch modes — a running
            timer keeps its current countdown.
          </p>
        </div>
      )}
    </div>
  );
}

function SettingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-gray-500 dark:text-gray-400">{label}</label>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-20 px-2 py-1.5 rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-neutral-400"
      />
    </div>
  );
}
