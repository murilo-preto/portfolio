import AsyncStorage from "@react-native-async-storage/async-storage";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { PresenceEvent, WatchedPlace } from "./api";
import { enqueue } from "./queue";
import { loadPairing } from "./storage";
import { flush } from "./sync";

/**
 * Geofencing: Android watches the places and wakes the app on each crossing,
 * even when it is closed. The app only reports what it saw; the server decides
 * what a crossing means (see flask-server/presence.py).
 *
 * The task is defined at module load, and index.ts imports this file before
 * registering the app. When Android wakes a closed app for a crossing it runs
 * the JS bundle without showing a screen, and a task that is not defined by
 * then is dropped.
 */
export const GEOFENCE_TASK = "namu-geofence";

/** Set while the user wants tracking on, even if there is nothing to watch yet. */
const TRACKING_KEY = "namu.tracking";
/** The places the running geofences were started with, to skip needless restarts. */
const SIGNATURE_KEY = "namu.geofenceSignature";

type GeofenceData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

/**
 * The events a task invocation reports. expo-location sends one crossing per
 * call; a list is accepted too, in case that ever batches. Regions whose
 * identifier is not a place id are not ours and are ignored.
 */
export function eventsFromTask(
  data: unknown,
  now: Date = new Date(),
  makeId: () => string = randomUUID,
): PresenceEvent[] {
  const items = (Array.isArray(data) ? data : [data]) as Partial<GeofenceData>[];
  const events: PresenceEvent[] = [];
  for (const item of items) {
    if (!item || !item.region) continue;
    const kind =
      item.eventType === Location.GeofencingEventType.Enter
        ? "enter"
        : item.eventType === Location.GeofencingEventType.Exit
          ? "exit"
          : null;
    const placeId = Number(item.region.identifier);
    if (!kind || !Number.isInteger(placeId) || placeId <= 0) continue;
    events.push({ clientEventId: makeId(), placeId, kind, occurredAt: now.toISOString() });
  }
  return events;
}

/**
 * Queues first and sends second: if sending fails, the event is still on the
 * phone for the next flush.
 */
export async function handleGeofenceTask({
  data,
  error,
}: TaskManager.TaskManagerTaskBody<unknown>): Promise<void> {
  if (error) return;
  const events = eventsFromTask(data);
  if (events.length === 0) return;
  await enqueue(events);
  const pairing = await loadPairing();
  if (pairing) await flush(pairing);
}

TaskManager.defineTask(GEOFENCE_TASK, handleGeofenceTask);

export type PermissionOutcome = "granted" | "foreground-denied" | "background-denied";

/**
 * Android asks in two steps: location while the app is open, then, separately,
 * "Allow all the time". Since Android 11 the second step is a trip to the
 * app's settings page rather than a dialog. Geofences only fire in the
 * background with the second, so the screen needs to know which step failed.
 */
export async function requestPermissions(): Promise<PermissionOutcome> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return "foreground-denied";
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? "granted" : "background-denied";
}

/**
 * Whether Android can geofence at all: location on, with "Google Location
 * Accuracy" too. Geofencing runs in Play services, which turns every geofence
 * down while Location Accuracy is off, and nothing reports an error: the app
 * would say tracking is on and never see a crossing. Location Accuracy is what
 * enables the network location provider, so that is what is checked. null when
 * the status cannot be read.
 */
export async function locationAccuracyOn(): Promise<boolean | null> {
  try {
    const status = await Location.getProviderStatusAsync();
    return status.locationServicesEnabled && status.networkAvailable === true;
  } catch {
    return null;
  }
}

/**
 * Shows Android's own "Turn on Location Accuracy" dialog (it does nothing if it
 * is on already). Resolves to whether it is on afterwards; declining the
 * dialog rejects inside expo-location, which is false here.
 */
export async function turnOnLocationAccuracy(): Promise<boolean> {
  try {
    await Location.enableNetworkProviderAsync();
  } catch {
    return false;
  }
  return (await locationAccuracyOn()) === true;
}

export async function isTracking(): Promise<boolean> {
  return (await AsyncStorage.getItem(TRACKING_KEY)) === "1";
}

/** Asks for permission, then watches `places`. Nothing changes unless granted. */
export async function startTracking(places: WatchedPlace[]): Promise<PermissionOutcome> {
  const outcome = await requestPermissions();
  if (outcome !== "granted") return outcome;
  await AsyncStorage.setItem(TRACKING_KEY, "1");
  await syncGeofences(places);
  return outcome;
}

export async function stopTracking(): Promise<void> {
  await AsyncStorage.removeItem(TRACKING_KEY);
  await stopGeofences();
}

async function stopGeofences(): Promise<void> {
  await AsyncStorage.removeItem(SIGNATURE_KEY);
  let started = false;
  try {
    started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // Not registered, or no permission any more: nothing to stop.
  }
  if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

/**
 * A fingerprint of what the geofences watch. Only ever compared, so it is
 * stored as a SHA-256 hash: the app's own storage then holds no coordinates.
 */
export async function signatureOf(places: WatchedPlace[]): Promise<string> {
  const plain = JSON.stringify(
    [...places]
      .sort((a, b) => a.id - b.id)
      .map((place) => [place.id, place.latitude, place.longitude, place.radiusM]),
  );
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, plain);
}

/**
 * Points the geofences at `places`, the enabled places the server sent.
 *
 * Restarting re-arms every region, and Android then reports an enter for the
 * place the phone is already in. The server ignores that repeat, but it is a
 * wasted wake-up and request on every refresh, so an unchanged list is left
 * alone. The OS forgets geofences on reboot, which is why "unchanged" also
 * requires them to be running.
 *
 * An empty list stops the geofences but leaves tracking on, so the first place
 * added on the web is picked up by the next refresh.
 */
export async function syncGeofences(places: WatchedPlace[]): Promise<void> {
  if (places.length === 0) {
    await stopGeofences();
    return;
  }
  const signature = await signatureOf(places);
  if ((await AsyncStorage.getItem(SIGNATURE_KEY)) === signature) {
    let started = false;
    try {
      started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    } catch {
      // Treated as not running, and restarted below.
    }
    if (started) return;
  }
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    places.map((place) => ({
      identifier: String(place.id),
      latitude: place.latitude,
      longitude: place.longitude,
      radius: place.radiusM,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
  await AsyncStorage.setItem(SIGNATURE_KEY, signature);
}
