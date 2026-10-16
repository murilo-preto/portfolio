import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError, fetchDeviceStatus, unpairDevice, type DeviceStatus, type Pairing } from "../api";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fetchDeviceStatus(pairing));
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
    <View style={styles.container}>
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

      <Text style={[styles.body, muted]}>
        Location tracking is not built yet. This screen only confirms the pairing works.
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, gap: 12 },
  title: { fontSize: 26, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 4 },
  heading: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  detail: { fontSize: 14 },
  body: { fontSize: 15, lineHeight: 21 },
  button: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  outline: { borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
