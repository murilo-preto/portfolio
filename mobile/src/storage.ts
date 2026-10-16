import * as SecureStore from "expo-secure-store";
import type { Pairing } from "./api";

/**
 * The pairing, kept in SecureStore, which encrypts it with a key held in the
 * Android Keystore. It is excluded from Android backups by the expo-secure-store
 * config plugin: a restored copy could not be decrypted on another phone anyway.
 *
 * The password is never stored, only the device token the server issued.
 */
const KEY = "namu.pairing";

export async function loadPairing(): Promise<Pairing | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Pairing>;
    if (
      typeof value.server === "string" &&
      typeof value.token === "string" &&
      typeof value.deviceId === "number" &&
      typeof value.deviceName === "string" &&
      typeof value.username === "string"
    ) {
      return value as Pairing;
    }
  } catch {
    // Unreadable: treat as not paired, below.
  }
  // Something this version cannot use is not a pairing. Clearing it lets the
  // user pair again instead of being stuck on a broken one.
  await SecureStore.deleteItemAsync(KEY);
  return null;
}

export async function savePairing(pairing: Pairing): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(pairing));
}

export async function clearPairing(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
