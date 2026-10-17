/**
 * Wording for the Namu app's stay and phones, kept apart from the components
 * so it can be tested without a DOM. Every function takes `now`, so a ticking
 * component re-renders it and a test pins it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An event that reached the server this much after it happened was queued. */
export const LATE_AFTER_MS = 2 * MINUTE;

/** A span as "45 min" or "2 h 14 min"; under a minute is "under a minute". */
export function spanLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return "under a minute";
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** How long a stay that started at `startedIso` has run, as of `now`. */
export function elapsedLabel(startedIso: string, now: Date): string {
  return spanLabel(now.getTime() - new Date(startedIso).getTime());
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; null is "never". */
export function agoLabel(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  const days = Math.floor(ms / DAY);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * How late an event reached the server, as "1 h 3 min late", or null when it
 * arrived within LATE_AFTER_MS. A late one was held in the phone's offline
 * queue, which explains a stay that appeared or ended after the fact.
 */
export function lateLabel(occurredIso: string, receivedIso: string): string | null {
  const ms = new Date(receivedIso).getTime() - new Date(occurredIso).getTime();
  if (!Number.isFinite(ms) || ms < LATE_AFTER_MS) return null;
  return `${spanLabel(ms)} late`;
}
