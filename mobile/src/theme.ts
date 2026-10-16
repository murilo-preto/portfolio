import { useColorScheme } from "react-native";

const light = {
  background: "#ffffff",
  surface: "#f5f5f5",
  text: "#171717",
  muted: "#525252",
  border: "#d4d4d4",
  accent: "#2563eb",
  accentText: "#ffffff",
  danger: "#b91c1c",
};

const dark: typeof light = {
  background: "#0a0a0a",
  surface: "#262626",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  border: "#404040",
  accent: "#3b82f6",
  accentText: "#ffffff",
  danger: "#f87171",
};

export type Theme = typeof light;

/** Follows the phone's light/dark setting, like the web app's "system" theme. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
