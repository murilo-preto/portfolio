import * as Device from "expo-device";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, pairDevice, type Pairing } from "../api";
import { checkServerUrl } from "../serverUrl";
import { useTheme } from "../theme";
import { DEFAULT_SERVER_URL, VARIANT } from "../variant";

type Props = {
  /** Shown above the form, e.g. after the pairing was revoked elsewhere. */
  notice: string | null;
  onPaired: (pairing: Pairing) => Promise<void>;
};

export function PairScreen({ notice, onPaired }: Props) {
  const theme = useTheme();
  const [server, setServer] = useState(DEFAULT_SERVER_URL);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(Device.modelName ?? "Android phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const checked = checkServerUrl(server, VARIANT);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    if (!username.trim() || !password || !deviceName.trim()) {
      setError("Fill in every field.");
      return;
    }

    setBusy(true);
    try {
      const pairing = await pairDevice(checked.url, {
        username: username.trim(),
        password,
        deviceName: deviceName.trim(),
      });
      // The password is not kept anywhere once pairing has used it.
      setPassword("");
      await onPaired(pairing);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  const label = [styles.label, { color: theme.muted }];

  return (
    <KeyboardAvoidingView behavior="height" style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>Pair this phone</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          Sign in once with your Namu account. The phone keeps its own key from then on, not your
          password.
        </Text>

        {notice ? (
          <Text testID="pair-notice" style={[styles.body, { color: theme.danger }]}>
            {notice}
          </Text>
        ) : null}

        <Text style={label}>Server</Text>
        <TextInput
          testID="server-input"
          style={input}
          value={server}
          onChangeText={setServer}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_SERVER_URL}
          placeholderTextColor={theme.muted}
        />

        <Text style={label}>Username</Text>
        <TextInput
          testID="username-input"
          style={input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
        />

        <Text style={label}>Password</Text>
        <TextInput
          testID="password-input"
          style={input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
        />

        <Text style={label}>Device name</Text>
        <TextInput
          testID="device-name-input"
          style={input}
          value={deviceName}
          onChangeText={setDeviceName}
        />

        {error ? (
          <Text testID="pair-error" style={[styles.body, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="pair-button"
          accessibilityRole="button"
          disabled={busy}
          onPress={submit}
          style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.accentText }]}>Pair</Text>
          )}
        </Pressable>

        {VARIANT === "lan" ? (
          <View style={styles.badge}>
            <Text style={[styles.badgeText, { color: theme.muted }]}>
              LAN test build: plain http:// is allowed to local addresses
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 24, paddingTop: 64, gap: 8 },
  title: { fontSize: 26, fontWeight: "600", marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  label: { fontSize: 13, marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { marginTop: 16, borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
  badge: { marginTop: 24 },
  badgeText: { fontSize: 12, textAlign: "center" },
});
