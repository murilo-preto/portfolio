import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { Pairing } from "./src/api";
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

  const handleUnpaired = useCallback(async (notice: string | null) => {
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
