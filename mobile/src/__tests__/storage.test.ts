import * as SecureStore from "expo-secure-store";

import type { Pairing } from "../api";
import { clearPairing, loadPairing, savePairing } from "../storage";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
    __store: store,
  };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const PAIRING: Pairing = {
  server: "https://namu.example",
  token: "namu_dev_abc",
  deviceId: 3,
  deviceName: "Pixel 8",
  username: "alice",
};

beforeEach(() => store.clear());

it("round-trips a pairing", async () => {
  await savePairing(PAIRING);
  expect(await loadPairing()).toEqual(PAIRING);
});

it("has no pairing until one is saved, and none after clearing", async () => {
  expect(await loadPairing()).toBeNull();
  await savePairing(PAIRING);
  await clearPairing();
  expect(await loadPairing()).toBeNull();
});

it.each([
  ["not JSON", "{oops"],
  ["missing the token", JSON.stringify({ ...PAIRING, token: undefined })],
  ["a wrong type", JSON.stringify({ ...PAIRING, deviceId: "3" })],
])("discards a stored value that is %s", async (_, raw) => {
  store.set("namu.pairing", raw);

  expect(await loadPairing()).toBeNull();
  // Cleared, so the user can pair again rather than being stuck.
  expect(store.has("namu.pairing")).toBe(false);
});
