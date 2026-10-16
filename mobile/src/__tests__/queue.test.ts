import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PresenceEvent } from "../api";
import { MAX_QUEUED, clear, count, enqueue, remove, take } from "../queue";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

function event(n: number): PresenceEvent {
  return {
    clientEventId: `id-${n}`,
    placeId: 7,
    kind: n % 2 ? "exit" : "enter",
    occurredAt: `2026-10-16T08:00:${String(n % 60).padStart(2, "0")}.000Z`,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it("starts empty", async () => {
  expect(await count()).toBe(0);
  expect(await take(10)).toEqual([]);
});

it("hands events back oldest first, without removing them", async () => {
  await enqueue([event(1), event(2)]);
  await enqueue([event(3)]);

  expect(await take(2)).toEqual([event(1), event(2)]);
  expect(await count()).toBe(3);
});

it("removes only the events named", async () => {
  await enqueue([event(1), event(2), event(3)]);

  await remove(["id-1", "id-3", "id-unknown"]);

  expect(await take(10)).toEqual([event(2)]);
});

it("drops the oldest events beyond the cap", async () => {
  await enqueue(Array.from({ length: MAX_QUEUED }, (_, i) => event(i)));
  await enqueue([event(MAX_QUEUED), event(MAX_QUEUED + 1)]);

  expect(await count()).toBe(MAX_QUEUED);
  const [first] = await take(1);
  expect(first.clientEventId).toBe("id-2");
});

it("clears", async () => {
  await enqueue([event(1)]);
  await clear();
  expect(await count()).toBe(0);
});

it("loses nothing when changes overlap", async () => {
  // Each change reads, then writes the whole list; unserialized, the second
  // read would miss the first write.
  await Promise.all([enqueue([event(1)]), enqueue([event(2)]), enqueue([event(3)])]);
  expect(await count()).toBe(3);
});

it("starts over from an unreadable value", async () => {
  await AsyncStorage.setItem("namu.eventQueue", "{oops");

  expect(await count()).toBe(0);
  await enqueue([event(1)]);
  expect(await take(10)).toEqual([event(1)]);
});
