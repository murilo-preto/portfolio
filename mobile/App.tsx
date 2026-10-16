import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { Pairing } from "./src/api";
import { stopTracking } from "./src/geofencing";
import { clear as clearQueue } from "./src/queue";
import { PairScreen } from "./src/screens/PairScreen";
import { StatusScreen } from "./src/screens/StatusScreen";
import { clearPairing, loadPairing, savePairing } from "./src/storage";
import { useTheme } from "./src/theme";

type State =
  | { kind: "loading" }
  | { kind: "unpaired"; notice: string | null }
  | { kind: "paired"; pairing: Pairing };

export default function App() {
  const theme = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    loadPairing()
      .then((pairing) =>
        setState(pairing ? { kind: "paired", pairing } : { kind: "unpaired", notice: null }),
      )
      .catch(() => setState({ kind: "unpaired", notice: null }));
  }, []);

  const handlePaired = useCallback(async (pairing: Pairing) => {
    await savePairing(pairing);
    setState({ kind: "paired", pairing });
  }, []);

  // Both ways a pairing ends, unpaired here or revoked from the web, come
  // through here. Events still queued belong to the old pairing and could
  // never be sent, and geofences left running would keep waking the phone.
  const handleUnpaired = useCallback(async (notice: string | null) => {
    await stopTracking().catch(() => undefined);
    await clearQueue();
    await clearPairing();
    setState({ kind: "unpaired", notice });
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      {state.kind === "loading" ? (
        <ActivityIndicator style={styles.root} color={theme.accent} />
      ) : state.kind === "paired" ? (
        <StatusScreen pairing={state.pairing} onUnpaired={handleUnpaired} />
      ) : (
        <PairScreen notice={state.notice} onPaired={handlePaired} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
