import { ApiError, postEvents, type Pairing, type Stay, type WatchedPlace } from "./api";
import { isTracking, stopTracking, syncGeofences } from "./geofencing";
import * as queue from "./queue";

/** The server refuses a larger batch. */
export const BATCH_SIZE = 100;

export type FlushOutcome =
  /** Nothing was waiting; no request was made. */
  | { kind: "empty" }
  | { kind: "sent"; sent: number; remaining: number; stay: Stay | null; places: WatchedPlace[] }
  /** Unreachable, rate limited, or a server error: every event is kept. */
  | { kind: "failed"; error: string; remaining: number }
  /** The token was refused. Geofencing is stopped; the queue is left for the caller. */
  | { kind: "unpaired" };

type Fetch = typeof fetch;

let inFlight: Promise<FlushOutcome> | null = null;

/**
 * Sends the oldest queued events, up to one batch.
 *
 * An event leaves the queue once the server has answered for it, whatever the
 * answer: accepted and duplicate are both stored, and a rejected one would be
 * rejected again. A failed request keeps them all, and they go with the next
 * flush; the server's client_event_id check makes a resend after a lost reply
 * harmless.
 *
 * A flush already running is joined rather than doubled, so the task and the
 * screen firing together send each event once.
 */
export function flush(pairing: Pairing, fetchImpl: Fetch = fetch): Promise<FlushOutcome> {
  if (!inFlight) {
    inFlight = flushOnce(pairing, fetchImpl).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function flushOnce(pairing: Pairing, fetchImpl: Fetch): Promise<FlushOutcome> {
  const events = await queue.take(BATCH_SIZE);
  if (events.length === 0) return { kind: "empty" };

  let reply;
  try {
    reply = await postEvents(pairing, events, fetchImpl);
  } catch (e) {
    if (e instanceof ApiError && e.isUnpaired) {
      // Nothing the phone sees from now on can be recorded, so stop waking
      // up for it. The pairing itself is the screen's to clear.
      await stopTracking();
      return { kind: "unpaired" };
    }
    return {
      kind: "failed",
      error: e instanceof Error ? e.message : "Could not send events.",
      remaining: await queue.count(),
    };
  }

  await queue.remove(reply.results.map((result) => result.clientEventId));

  if (await isTracking()) {
    try {
      await syncGeofences(reply.places);
    } catch {
      // Permission withdrawn in the settings, most likely. The events were
      // still delivered; the screen shows tracking as on until it is fixed.
    }
  }

  return {
    kind: "sent",
    sent: reply.results.length,
    remaining: await queue.count(),
    stay: reply.stay,
    places: reply.places,
  };
}
