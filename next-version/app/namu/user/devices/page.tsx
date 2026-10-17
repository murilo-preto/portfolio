"use client";

import { useCallback, useEffect, useState } from "react";
import type { Device, PresenceEvent, Stay } from "@/lib/types";
import { warmFetch } from "@/lib/prefetch";
import { PrefetchLink } from "@/components/PrefetchLink";
import { StayBanner } from "@/components/presence/StayBanner";
import { agoLabel, lateLabel } from "@/components/presence/presenceText";

// The web side of the Namu Android app: what it is counting right now, which
// phones can report for this account, and the arrivals and departures they
// reported. Pairing happens on the phone, with the account's password; this
// page only revokes. Nothing here reads location.

type Status = "idle" | "success" | "error";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    return fallback;
  }
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

const GHOST_BUTTON_CLASS =
  "text-xs px-2.5 py-1.5 rounded-lg border border-default bg-surface-raised " +
  "hover:bg-surface-hover transition-colors disabled:opacity-40 " +
  "disabled:cursor-not-allowed";

const DANGER_BUTTON_CLASS =
  "px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm " +
  "font-medium disabled:opacity-40";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs text-muted uppercase tracking-wide">{children}</h2>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "green";
}) {
  const tones = {
    neutral: "bg-surface-hover text-secondary",
    amber: "bg-tint-amber-a text-tint-amber-ink border border-tint-amber-line",
    green: "bg-tint-green-a text-tint-green-ink border border-tint-green-line",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center text-center px-4 py-6 rounded-xl border-2 border-dashed border-default text-sm text-dim">
      {children}
    </div>
  );
}

// ─── Current stay ────────────────────────────────────────────────────────────

function StaySection({
  stay,
  onEnded,
  onError,
}: {
  stay: Stay | null;
  onEnded: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleEnd() {
    setBusy(true);
    try {
      const res = await fetch("/api/presence/stay/end", { method: "POST" });
      if (!res.ok) {
        onError(await readError(res, "Failed to end the stay"));
        return;
      }
      const data = await res.json();
      setConfirming(false);
      onEnded(
        data.entry_id
          ? `Ended the stay at “${stay?.place_name}” and logged it.`
          : `Ended the stay at “${stay?.place_name}”. It was too short to log.`,
      );
    } catch {
      onError("Failed to end the stay");
    } finally {
      setBusy(false);
    }
  }

  if (!stay) {
    return <Empty>Not at a tracked place</Empty>;
  }

  return (
    <div className="space-y-2">
      <StayBanner
        stay={stay}
        action={
          !confirming && (
            <button className={GHOST_BUTTON_CLASS} onClick={() => setConfirming(true)}>
              End now
            </button>
          )
        }
      />
      {confirming && (
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={handleEnd} disabled={busy} className={DANGER_BUTTON_CLASS}>
            {busy ? "…" : "End stay"}
          </button>
          <button onClick={() => setConfirming(false)} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <p className="basis-full text-xs text-muted">
            {stay.departed_at
              ? "Logs it now, ending when you left, without waiting for the re-entry window."
              : "Logs it as ending now. Use this when the phone will not report leaving, for example because it is off. Arriving again starts a new stay only after the phone reports leaving."}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Phones ──────────────────────────────────────────────────────────────────

function DeviceRow({
  device,
  now,
  onChanged,
  onError,
}: {
  device: Device;
  now: Date;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const revoked = device.revoked_at !== null;

  async function handleRevoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/devices/${device.id}/revoke`, { method: "POST" });
      if (!res.ok) {
        onError(await readError(res, "Failed to revoke phone"));
        return;
      }
      setConfirming(false);
      onChanged(`Revoked “${device.name}”.`);
    } catch {
      onError("Failed to revoke phone");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-xl border border-default px-3 py-2.5 space-y-3 ${
        revoked ? "bg-surface-muted opacity-60" : "bg-surface-raised"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{device.name}</span>
            {revoked && <Pill>revoked</Pill>}
          </div>
          <p className="text-xs text-muted mt-0.5">
            Paired {shortDate(device.created_at)}
            {revoked
              ? ` · revoked ${shortDate(device.revoked_at!)}`
              : ` · last seen ${agoLabel(device.last_seen_at, now)}`}
          </p>
        </div>
        {!revoked && !confirming && (
          <button
            className={`${GHOST_BUTTON_CLASS} text-red-600 dark:text-red-400`}
            onClick={() => setConfirming(true)}
          >
            Revoke
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex gap-2 flex-wrap items-center">
          <button onClick={handleRevoke} disabled={busy} className={DANGER_BUTTON_CLASS}>
            {busy ? "…" : "Revoke"}
          </button>
          <button onClick={() => setConfirming(false)} className={GHOST_BUTTON_CLASS}>
            Cancel
          </button>
          <p className="basis-full text-xs text-muted">
            “{device.name}” stops reporting at once and cannot be reinstated; to
            use it again, pair it again from the app. A stay it started keeps
            counting until it ends or you end it above.
          </p>
        </div>
      )}
    </li>
  );
}

// ─── Recent events ───────────────────────────────────────────────────────────

function EventRow({ event }: { event: PresenceEvent }) {
  const arrived = event.kind === "enter";
  const late = lateLabel(event.occurred_at, event.received_at);

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
        <span
          aria-hidden
          className={`shrink-0 w-5 text-center ${
            arrived ? "text-tint-green-ink" : "text-muted"
          }`}
        >
          {arrived ? "→" : "←"}
        </span>
        <span className="truncate">
          {arrived ? "Arrived at" : "Left"}{" "}
          <span className="font-medium">{event.place_name}</span>
        </span>
        {late && (
          <span title="Held in the phone's queue before it reached the server">
            <Pill tone="amber">{late}</Pill>
          </span>
        )}
      </div>
      <div className="text-xs text-muted text-right shrink-0">
        <div>{dateTime(event.occurred_at)}</div>
        <div className="truncate max-w-[10rem]">
          {event.device_name ?? "removed phone"}
        </div>
      </div>
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NamuAppPage() {
  const [stay, setStay] = useState<Stay | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<PresenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  function report(next: Status, text: string) {
    setStatus(next);
    setMessage(text);
  }

  const load = useCallback(async () => {
    try {
      const [stayRes, devicesRes, eventsRes] = await Promise.all([
        warmFetch("/api/presence/stay"),
        warmFetch("/api/devices"),
        warmFetch("/api/presence/events"),
      ]);
      for (const [res, fallback] of [
        [stayRes, "Failed to load the current stay"],
        [devicesRes, "Failed to load phones"],
        [eventsRes, "Failed to load recent events"],
      ] as const) {
        if (!res.ok) throw new Error(await readError(res, fallback));
      }
      setStay((await stayRes.json()).stay ?? null);
      setDevices((await devicesRes.json()).devices ?? []);
      setEvents((await eventsRes.json()).events ?? []);
      setNow(new Date());
    } catch (err) {
      report("error", err instanceof Error ? err.message : "Failed to load");
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

  const active = devices.filter((d) => d.revoked_at === null);
  const revoked = devices.filter((d) => d.revoked_at !== null);

  return (
    <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-3xl mx-auto space-y-8 text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Namu app</h1>
        <p className="text-sm text-muted mt-1">
          Your phone counts the time you spend at your{" "}
          <PrefetchLink href="/namu/user/places" className="underline hover:text-secondary">
            places
          </PrefetchLink>{" "}
          and logs each stay as a time entry when you leave.
        </p>
      </div>

      {message && (
        <p
          className={`text-sm ${status === "success" ? "text-tint-green-ink dark:text-green-400" : "text-red-500"}`}
        >
          {message}
        </p>
      )}

      <section className="space-y-3">
        <SectionTitle>Now</SectionTitle>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <StaySection
            stay={stay}
            onEnded={handleChanged}
            onError={(text) => report("error", text)}
          />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>
          {loading ? "Phones" : `Phones · ${active.length} paired`}
        </SectionTitle>
        {!loading && devices.length === 0 && (
          <Empty>
            No phones paired. Install the Namu app and sign in with this
            account&apos;s password to pair one.
          </Empty>
        )}
        <ul className="space-y-2">
          {[...active, ...revoked].map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              now={now}
              onChanged={handleChanged}
              onError={(text) => report("error", text)}
            />
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <SectionTitle>Recent arrivals and departures</SectionTitle>
        {!loading && events.length === 0 && (
          <Empty>Nothing reported yet</Empty>
        )}
        {events.length > 0 && (
          <ul className="rounded-xl border border-default bg-surface-raised divide-y divide-subtle">
            {events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
