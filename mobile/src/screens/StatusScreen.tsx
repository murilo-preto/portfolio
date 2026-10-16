import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  unpairDevice,
  type DeviceStatus,
  type Pairing,
  type WatchedPlace,
} from "../api";
import { useTheme } from "../theme";

type Props = {
  pairing: Pairing;
  /** The pairing is over: unpaired here, or revoked from the web. */
  onUnpaired: (notice: string | null) => Promise<void>;
};

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export function StatusScreen({ pairing, onUnpaired }: Props) {
  const theme = useTheme();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [places, setPlaces] = useState<WatchedPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextStatus, nextPlaces] = await Promise.all([
        fetchDeviceStatus(pairing),
        fetchPlaces(pairing),
      ]);
      setStatus(nextStatus);
      setPlaces(nextPlaces);
    } catch (e) {
      if (e instanceof ApiError && e.isUnpaired) {
        await onUnpaired("This phone was unpaired from your account. Pair it again to continue.");
        return;
      }
      setError(e instanceof ApiError ? e.message : "Could not check the pairing.");
    } finally {
      setBusy(false);
    }
  }, [pairing, onUnpaired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function unpair() {
    setBusy(true);
    setError(null);
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

      <Text style={[styles.body, muted]}>
        Location tracking is not built yet. These are the places it will watch.
      </Text>

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
  placeName: { fontSize: 15, fontWeight: "500" },
  body: { fontSize: 15, lineHeight: 21 },
  button: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  outline: { borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
