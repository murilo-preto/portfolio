import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PresenceEvent } from "./api";

/**
 * Events waiting to reach the server, oldest first. The geofencing task writes
 * here before it tries to send anything, so an arrival seen in a tunnel or with
 * the server down is sent on a later flush rather than lost.
 *
 * AsyncStorage rather than SecureStore: these are a place id, a kind and a
 * time, not a credential, and SecureStore is meant for small values.
 *
 * Every change is a read-modify-write of one key, so they are chained one
 * after another: the background task and the status screen can both touch the
 * queue when they share a JS runtime, and two interleaved writes would drop
 * one side's change.
 */
const KEY = "namu.eventQueue";

/**
 * A phone that cannot reach the server for weeks stops growing the queue
 * here, dropping the oldest events. By then those stays are long past the
 * server's 16 h cap anyway.
 */
export const MAX_QUEUED = 1000;

let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function read(): Promise<PresenceEvent[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as PresenceEvent[]) : [];
  } catch {
    // Unreadable: start over rather than block every later event behind it.
    return [];
  }
}

async function write(events: PresenceEvent[]): Promise<void> {
  if (events.length === 0) {
    await AsyncStorage.removeItem(KEY);
  } else {
    await AsyncStorage.setItem(KEY, JSON.stringify(events));
  }
}

export function enqueue(events: PresenceEvent[]): Promise<void> {
  return serialized(async () => {
    const all = [...(await read()), ...events];
    await write(all.slice(Math.max(0, all.length - MAX_QUEUED)));
  });
}

/** The oldest `n` events, left in the queue until `remove` confirms them sent. */
export function take(n: number): Promise<PresenceEvent[]> {
  return serialized(async () => (await read()).slice(0, n));
}

export function remove(clientEventIds: string[]): Promise<void> {
  const gone = new Set(clientEventIds);
  return serialized(async () => {
    const events = await read();
    const kept = events.filter((event) => !gone.has(event.clientEventId));
    if (kept.length !== events.length) await write(kept);
  });
}

export function count(): Promise<number> {
  return serialized(async () => (await read()).length);
}

export function clear(): Promise<void> {
  return serialized(() => AsyncStorage.removeItem(KEY));
}
