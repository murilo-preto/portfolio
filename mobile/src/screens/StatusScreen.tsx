import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ApiError,
  fetchDeviceStatus,
  fetchPlaces,
  fetchStay,
  unpairDevice,
  type DeviceStatus,
  type Pairing,
  type Stay,
  type WatchedPlace,
} from "../api";
import {
  isTracking,
  locationAccuracyOn,
  startTracking,
  stopTracking,
  syncGeofences,
  turnOnLocationAccuracy,
  type PermissionOutcome,
} from "../geofencing";
import { count as queuedCount } from "../queue";
import { flush } from "../sync";
import { useTheme } from "../theme";

type Props = {
  pairing: Pairing;
  /** The pairing is over: unpaired here, or revoked from the web. */
  onUnpaired: (notice: string | null) => Promise<void>;
};

const REVOKED =
  "This phone was unpaired from your account. Pair it again to continue.";

const ACCURACY_OFF =
  "Location Accuracy is off, so Android won't notice when you arrive at or leave your places. Tracking can't work until it's on.";

const PERMISSION_HELP: Record<Exclude<PermissionOutcome, "granted">, string> = {
  "foreground-denied":
    "Namu needs your location to notice when you arrive at a place. Allow it to start tracking.",
  "background-denied":
    'Namu has to see your location while it is closed. In its location permission, choose "Allow all the time", then start tracking again.',
};

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

function stayText(stay: Stay | null | undefined): string {
  if (stay === undefined) return "…";
  if (stay === null) return "Not at any of your places";
  if (stay.departedAt) return `Leaving ${stay.placeName}…`;
  return `At ${stay.placeName} since ${formatTime(stay.startedAt)}`;
}

export function StatusScreen({ pairing, onUnpaired }: Props) {
  const theme = useTheme();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [places, setPlaces] = useState<WatchedPlace[] | null>(null);
  // undefined until the server has answered; null is "not at any place".
  const [stay, setStay] = useState<Stay | null | undefined>(undefined);
  const [tracking, setTracking] = useState(false);
  const [queued, setQueued] = useState(0);
  const [trackingHelp, setTrackingHelp] = useState<string | null>(null);
  // null until read, and when it cannot be: no warning is shown then.
  const [accuracyOn, setAccuracyOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Sends what is queued first, so the stay shown includes it. A successful
   * send already returns the stay and the places, which saves two requests
   * against the device's rate limit.
   */
  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await flush(pairing);
      if (sent.kind === "unpaired") {
        await onUnpaired(REVOKED);
        return;
      }
      const [nextStatus, nextPlaces, nextStay] = await Promise.all([
        fetchDeviceStatus(pairing),
        sent.kind === "sent" ? sent.places : fetchPlaces(pairing),
        sent.kind === "sent" ? sent.stay : fetchStay(pairing),
      ]);
      setStatus(nextStatus);
      setPlaces(nextPlaces);
      setStay(nextStay);
      if (await isTracking()) {
        try {
          await syncGeofences(nextPlaces);
        } catch {
          setError(
            'Could not watch your places. Check that Namu\'s location permission is "Allow all the time".',
          );
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.isUnpaired) {
        await onUnpaired(REVOKED);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Could not check the pairing.");
    } finally {
      setQueued(await queuedCount().catch(() => 0));
      setTracking(await isTracking().catch(() => false));
      setBusy(false);
    }
  }, [pairing, onUnpaired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Location Accuracy is read on opening, and again whenever the app comes
  // back to the front: the usual way to fix it is a trip to Android's
  // settings, and the warning should be gone on return.
  const checkAccuracy = useCallback(async () => {
    setAccuracyOn(await locationAccuracyOn());
  }, []);

  useEffect(() => {
    void checkAccuracy();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkAccuracy();
    });
    return () => subscription.remove();
  }, [checkAccuracy]);

  async function turnOnAccuracy() {
    setBusy(true);
    try {
      setAccuracyOn(await turnOnLocationAccuracy());
    } finally {
      setBusy(false);
    }
  }

  async function toggleTracking() {
    setBusy(true);
    setError(null);
    setTrackingHelp(null);
    try {
      if (tracking) {
        await stopTracking();
      } else {
        const outcome = await startTracking(places ?? []);
        if (outcome !== "granted") setTrackingHelp(PERMISSION_HELP[outcome]);
      }
    } catch {
      setError("Could not change tracking. Try again.");
    } finally {
      setTracking(await isTracking().catch(() => false));
      setBusy(false);
    }
  }

  async function unpair() {
    setBusy(true);
    setError(null);
    // Last chance for anything queued to reach the account. Best effort:
    // unpairing must not depend on it.
    await flush(pairing).catch(() => undefined);
    try {
      await unpairDevice(pairing);
    } catch (e) {
      // Already refused by the server means already unpaired: carry on. Any
      // other failure keeps the pairing, so the token is never forgotten here
      // while it still works on the server.
      if (!(e instanceof ApiError && e.isUnpaired)) {
        setError(e instanceof ApiError ? e.message : "Could not unpair.");
        setBusy(false);
        return;
      }
    }
    // Stops tracking and empties the queue too (App.tsx).
    await onUnpaired(null);
  }

  const muted = { color: theme.muted };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refresh} colors={[theme.accent]} />
      }
    >
      <Text style={[styles.title, { color: theme.text }]}>Namu</Text>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text testID="paired-as" style={[styles.heading, { color: theme.text }]}>
          Paired as {pairing.username}
        </Text>
        <Text style={[styles.detail, muted]}>Server: {pairing.server}</Text>
        <Text style={[styles.detail, muted]}>This phone: {pairing.deviceName}</Text>
        <Text testID="last-seen" style={[styles.detail, muted]}>
          Last checked in: {status ? formatTime(status.lastSeenAt) : "…"}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text testID="tracking-state" style={[styles.heading, { color: theme.text }]}>
          {tracking ? "Tracking is on" : "Tracking is off"}
        </Text>
        <Text testID="stay-text" style={[styles.detail, muted]}>
          {stayText(stay)}
        </Text>
        {queued > 0 ? (
          <Text testID="queue-count" style={[styles.detail, muted]}>
            {queued === 1 ? "1 event waiting to send" : `${queued} events waiting to send`}
          </Text>
        ) : null}
        {trackingHelp ? (
          <Text testID="tracking-help" style={[styles.detail, { color: theme.danger }]}>
            {trackingHelp}
          </Text>
        ) : null}
        {accuracyOn === false ? (
          <View testID="accuracy-warning" style={styles.warning}>
            <Text style={[styles.detail, { color: theme.danger }]}>{ACCURACY_OFF}</Text>
            <Pressable
              testID="accuracy-button"
              accessibilityRole="button"
              disabled={busy}
              onPress={turnOnAccuracy}
              style={[styles.button, styles.cardButton, styles.outline, { borderColor: theme.danger }]}
            >
              <Text style={[styles.buttonText, { color: theme.danger }]}>
                Turn on Location Accuracy
              </Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          testID="tracking-button"
          accessibilityRole="button"
          disabled={busy}
          onPress={toggleTracking}
          style={[
            styles.button,
            styles.cardButton,
            tracking
              ? [styles.outline, { borderColor: theme.accent }]
              : { backgroundColor: theme.accent },
          ]}
        >
          <Text
            style={[styles.buttonText, { color: tracking ? theme.accent : theme.accentText }]}
          >
            {tracking ? "Stop tracking" : "Start tracking"}
          </Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text testID="places-heading" style={[styles.heading, { color: theme.text }]}>
          Places{places ? ` (${places.length})` : ""}
        </Text>
        {places === null ? (
          <Text style={[styles.detail, muted]}>…</Text>
        ) : places.length === 0 ? (
          <Text testID="no-places" style={[styles.detail, muted]}>
            No places yet. Add them on the web, under Time, then Places.
          </Text>
        ) : (
          places.map((place) => (
            <View key={place.id} testID={`place-${place.id}`} style={styles.place}>
              <Text style={[styles.placeName, { color: theme.text }]}>{place.name}</Text>
              <Text style={[styles.detail, muted]}>
                {place.category} · {place.radiusM} m
              </Text>
            </View>
          ))
        )}
      </View>

      {error ? (
        <Text testID="status-error" style={[styles.body, { color: theme.danger }]}>
          {error}
        </Text>
      ) : null}

      {busy ? <ActivityIndicator color={theme.accent} /> : null}

      <Pressable
        testID="refresh-button"
        accessibilityRole="button"
        disabled={busy}
        onPress={refresh}
        style={[styles.button, { backgroundColor: theme.accent }]}
      >
        <Text style={[styles.buttonText, { color: theme.accentText }]}>Check again</Text>
      </Pressable>

      <Pressable
        testID="unpair-button"
        accessibilityRole="button"
        disabled={busy}
        onPress={unpair}
        style={[styles.button, styles.outline, { borderColor: theme.danger }]}
      >
        <Text style={[styles.buttonText, { color: theme.danger }]}>Unpair this phone</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 64, gap: 12 },
  title: { fontSize: 26, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  heading: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  detail: { fontSize: 14 },
  place: { paddingVertical: 4 },
  warning: { marginTop: 8 },
  placeName: { fontSize: 15, fontWeight: "500" },
  body: { fontSize: 15, lineHeight: 21 },
  button: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  cardButton: { marginTop: 8 },
  outline: { borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
