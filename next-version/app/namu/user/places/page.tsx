"use client";

import { useCallback, useEffect, useState } from "react";
import type { Category, Place } from "@/lib/types";
import { warmFetch } from "@/lib/prefetch";

// Places are what the Namu Android app geofences: arriving at one starts a stay,
// leaving it logs a time entry in the place's category. This page only manages
// them; nothing here tracks location. "Use my current location" reads the
// browser's position once, to fill the form, and nothing else is kept.
//
// There is no map on purpose. Map tiles come from a third-party server, and
// every tile requested would tell it roughly where the user's places are.

const MIN_RADIUS = 100;
const MAX_RADIUS = 2000;
const DEFAULT_RADIUS = 150;

type Status = "idle" | "success" | "error";

type FormValues = {
  name: string;
  categoryId: string;
  latitude: string;
  longitude: string;
  radius: string;
  enabled: boolean;
};

const EMPTY_FORM: FormValues = {
  name: "",
  categoryId: "",
  latitude: "",
  longitude: "",
  radius: String(DEFAULT_RADIUS),
  enabled: true,
};

function formFromPlace(place: Place): FormValues {
  return {
    name: place.name,
    categoryId: String(place.category_id),
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    radius: String(place.radius_m),
    enabled: place.enabled,
  };
}

/** The JSON body for a create or update. Flask validates it; this only shapes it. */
function bodyFromForm(form: FormValues) {
  return {
    name: form.name.trim(),
    category_id: Number(form.categoryId),
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    radius_m: Number(form.radius),
    enabled: form.enabled,
  };
}

function osmLink(latitude: number | string, longitude: number | string): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

const INPUT_CLASS =
  "px-3 py-2 rounded-lg border border-strong bg-surface-raised text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-neutral-400";

const GHOST_BUTTON_CLASS =
  "text-xs px-2.5 py-1.5 rounded-lg border border-default bg-surface-raised " +
  "hover:bg-surface-hover transition-colors disabled:opacity-40 " +
  "disabled:cursor-not-allowed";

const PRIMARY_BUTTON_CLASS =
  "px-4 py-2 rounded-lg bg-invert text-invert-fg text-sm font-medium " +
  "disabled:opacity-50 hover:opacity-90 transition-opacity";

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber";
}) {
  const tones = {
    neutral: "bg-surface-hover text-secondary",
    amber: "bg-tint-amber-a text-tint-amber-ink border border-tint-amber-line",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

// ─── Form ────────────────────────────────────────────────────────────────────

function PlaceForm({
  initial,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  categories: Category[];
  submitLabel: string;
  onSubmit: (form: FormValues) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function fillCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setLocationNote("This browser cannot share its location.");
      return;
    }
    setLocating(true);
    setLocationNote(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setForm((current) => ({
          ...current,
          latitude: latitude.toFixed(6),
          longitude: longitude.toFixed(6),
        }));
        const radius = Number(form.radius) || DEFAULT_RADIUS;
        setLocationNote(
          accuracy > radius
            ? `Accurate to about ${Math.round(accuracy)} m, which is more than the radius. Try again outdoors, or check it on the map.`
            : `Accurate to about ${Math.round(accuracy)} m.`,
        );
        setLocating(false);
      },
      (error) => {
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was refused."
            : "Could not get your location.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  const complete =
    form.name.trim() !== "" &&
    form.categoryId !== "" &&
    form.latitude.trim() !== "" &&
    form.longitude.trim() !== "" &&
    form.radius.trim() !== "";

  const hasPoint =
    form.latitude.trim() !== "" &&
    form.longitude.trim() !== "" &&
    Number.isFinite(Number(form.latitude)) &&
    Number.isFinite(Number(form.longitude));

  async function submit() {
    if (!complete) return;
    setBusy(true);
    try {
      await onSubmit(form);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            autoFocus
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={100}
            placeholder="Work"
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Log stays as">
          <select
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Latitude">
          <input
            value={form.latitude}
            onChange={(e) => set("latitude", e.target.value)}
            inputMode="decimal"
            placeholder="-23.561414"
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>
        <Field label="Longitude">
          <input
            value={form.longitude}
            onChange={(e) => set("longitude", e.target.value)}
            inputMode="decimal"
            placeholder="-46.655881"
            className={`${INPUT_CLASS} font-mono`}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={fillCurrentLocation}
          disabled={locating}
          className={GHOST_BUTTON_CLASS}
        >
          {locating ? "Locating…" : "Use my current location"}
        </button>
        {hasPoint && (
          <a
            href={osmLink(form.latitude.trim(), form.longitude.trim())}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-secondary underline hover:text-primary"
          >
            View on OpenStreetMap
          </a>
        )}
        {locationNote && (
          <p className="basis-full text-xs text-muted">{locationNote}</p>
        )}
      </div>

      <Field label={`Radius: ${form.radius || "—"} m`}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={10}
            value={Number(form.radius) || MIN_RADIUS}
            onChange={(e) => set("radius", e.target.value)}
            className="flex-1 accent-neutral-500"
          />
          <input
            type="number"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            value={form.radius}
            onChange={(e) => set("radius", e.target.value)}
            className={`${INPUT_CLASS} w-24`}
          />
        </div>
      </Field>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        Watch this place
      </label>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !complete}
          className={PRIMARY_BUTTON_CLASS}
        >
          {busy ? "…" : submitLabel}
        </button>
        <button onClick={onCancel} className={GHOST_BUTTON_CLASS}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

type RowMode = "none" | "edit" | "delete";

function PlaceRow({
  place,
  categories,
  onChanged,
  onError,
}: {
  place: Place;
  categories: Category[];
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>("none");
  const [busy, setBusy] = useState(false);

  async function send(init: RequestInit, fallback: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/places/${place.id}`, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        onError(await readError(res, fallback));
        return false;
      }
      return true;
    } catch {
      onError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    const ok = await send(
      { method: "PATCH", body: JSON.stringify({ enabled: !place.enabled }) },
      "Failed to update place",
    );
    if (ok) {
      onChanged(
        place.enabled
          ? `Paused “${place.name}”.`
          : `“${place.name}” is being watched again.`,
      );
    }
  }

  async function handleEdit(form: FormValues) {
    const ok = await send(
      { method: "PATCH", body: JSON.stringify(bodyFromForm(form)) },
      "Failed to update place",
    );
    if (ok) {
      setMode("none");
      onChanged(`Saved “${form.name.trim()}”.`);
    }
    return ok;
  }

  async function handleDelete() {
    const ok = await send({ method: "DELETE" }, "Failed to delete place");
    if (ok) onChanged(`Deleted “${place.name}”.`);
  }

  return (
    <li className="rounded-xl border border-default bg-surface-raised px-3 py-2.5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-medium text-sm truncate">{place.name}</span>
          <Pill>{place.category}</Pill>
          <Pill>{place.radius_m} m</Pill>
          {!place.enabled && <Pill tone="amber">paused</Pill>}
        </div>

        <div className="flex gap-1.5 shrink-0">
          <button
            className={GHOST_BUTTON_CLASS}
            disabled={busy}
            onClick={handleToggle}
          >
            {place.enabled ? "Pause" : "Resume"}
          </button>
          <button
            className={GHOST_BUTTON_CLASS}
            onClick={() => setMode(mode === "edit" ? "none" : "edit")}
          >
            Edit
          </button>
          <button
            className={`${GHOST_BUTTON_CLASS} text-red-600 dark:text-red-400`}
            onClick={() => setMode(mode === "delete" ? "none" : "delete")}
          >
            Delete
          </button>
        </div>
      </div>

      <a
        href={osmLink(place.latitude, place.longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs font-mono text-muted hover:text-secondary"
      >
        {place.latitude.toFixed(6)}, {place.longitude.toFixed(6)}
      </a>

      {mode === "edit" && (
        <PlaceForm
          initial={formFromPlace(place)}
          categories={categories}
          submitLabel="Save"
          onSubmit={handleEdit}
          onCancel={() => setMode("none")}
        />
      )}

      {mode === "delete" && (
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={handleDelete}
            disabled={busy}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40"
          >
            {busy ? "…" : "Delete"}
          </button>
          <button onClick={() => setMode("none")} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <p className="basis-full text-xs text-muted">
            Deletes “{place.name}” and its arrival and departure history. Time
            entries already logged stay. To stop watching it but keep the
            history, pause it instead.
          </p>
        </div>
      )}
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PlacesPage() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  function report(next: Status, text: string) {
    setStatus(next);
    setMessage(text);
  }

  const load = useCallback(async () => {
    try {
      const [placesRes, categoriesRes] = await Promise.all([
        warmFetch("/api/places"),
        warmFetch("/api/categories"),
      ]);
      if (!placesRes.ok) {
        throw new Error(await readError(placesRes, "Failed to load places"));
      }
      if (!categoriesRes.ok) {
        throw new Error(await readError(categoriesRes, "Failed to load categories"));
      }
      setPlaces((await placesRes.json()).places ?? []);
      setCategories((await categoriesRes.json()).categories ?? []);
    } catch (err) {
      report("error", err instanceof Error ? err.message : "Failed to load places");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function handleChanged(text: string) {
    report("success", text);
    await load();
  }

  async function handleCreate(form: FormValues) {
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyFromForm(form)),
      });
      if (!res.ok) {
        report("error", await readError(res, "Failed to create place"));
        return false;
      }
      setCreating(false);
      await handleChanged(`Created “${form.name.trim()}”.`);
      return true;
    } catch {
      report("error", "Failed to create place");
      return false;
    }
  }

  const watched = places.filter((p) => p.enabled).length;

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-3xl mx-auto space-y-6 text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Places</h1>
        <p className="text-sm text-muted mt-1">
          The Namu app on your phone watches these. Arriving at one starts
          counting, and leaving logs the time in its category.
        </p>
      </div>

      {creating ? (
        <div className="rounded-xl border border-default bg-surface-raised p-4">
          <PlaceForm
            initial={EMPTY_FORM}
            categories={categories}
            submitLabel="Create"
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className={PRIMARY_BUTTON_CLASS}>
          New place
        </button>
      )}

      {message && (
        <p
          className={`text-sm ${status === "success" ? "text-tint-green-ink dark:text-green-400" : "text-red-500"}`}
        >
          {message}
        </p>
      )}

      <p className="text-xs text-muted uppercase tracking-wide">
        {loading ? "Loading…" : `${places.length} places · ${watched} watched`}
      </p>

      {!loading && places.length === 0 && (
        <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-default text-sm text-dim">
          No places yet
        </div>
      )}

      <ul className="space-y-2">
        {places.map((place) => (
          <PlaceRow
            key={place.id}
            place={place}
            categories={categories}
            onChanged={handleChanged}
            onError={(text) => report("error", text)}
          />
        ))}
      </ul>
    </main>
  );
}
