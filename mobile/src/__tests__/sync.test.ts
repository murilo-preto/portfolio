import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Pairing, PresenceEvent } from "../api";
import { isTracking, stopTracking, syncGeofences } from "../geofencing";
import { count, enqueue, take } from "../queue";
import { BATCH_SIZE, flush } from "../sync";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The real module pulls in the native location and task-manager modules.
jest.mock("../geofencing", () => ({
  isTracking: jest.fn(async () => false),
  stopTracking: jest.fn(async () => undefined),
  syncGeofences: jest.fn(async () => undefined),
}));

const PAIRING: Pairing = {
  server: "https://namu.example",
  token: "namu_dev_abc",
  deviceId: 3,
  deviceName: "Pixel 8",
  username: "alice",
};

const PLACE = {
  id: 7,
  name: "Office",
  category_id: 9,
  category: "Work",
  latitude: -23.5,
  longitude: -46.6,
  radius_m: 150,
  enabled: true,
};

function event(n: number): PresenceEvent {
  return { clientEventId: `id-${n}`, placeId: 7, kind: "enter", occurredAt: "2026-10-16T08:00:00.000Z" };
}

function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Answers every event it is sent with `status`, the way the server does. */
function answering(status: string) {
  return jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)).events as { client_event_id: string }[];
    return reply(200, {
      results: sent.map((e) => ({ client_event_id: e.client_event_id, status })),
      stay: null,
      places: [PLACE],
    });
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(isTracking).mockResolvedValue(false);
  jest.mocked(stopTracking).mockClear();
  jest.mocked(syncGeofences).mockClear();
});

it("makes no request when nothing is queued", async () => {
  const fetchImpl = jest.fn();

  expect(await flush(PAIRING, fetchImpl)).toEqual({ kind: "empty" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it.each(["accepted", "duplicate", "rejected"])(
  "drops events the server answered %s",
  async (status) => {
    await enqueue([event(1), event(2)]);

    const outcome = await flush(PAIRING, answering(status));

    expect(outcome).toMatchObject({ kind: "sent", sent: 2, remaining: 0, stay: null });
    expect(await count()).toBe(0);
  },
);

it("keeps an event the server did not answer for", async () => {
  await enqueue([event(1), event(2)]);
  const fetchImpl = jest.fn().mockResolvedValue(
    reply(200, { results: [{ client_event_id: "id-1", status: "accepted" }], stay: null, places: [] }),
  );

  await flush(PAIRING, fetchImpl);

  expect(await take(10)).toEqual([event(2)]);
});

it("sends at most one batch, oldest first", async () => {
  await enqueue(Array.from({ length: BATCH_SIZE + 5 }, (_, i) => event(i)));
  const fetchImpl = answering("accepted");

  const outcome = await flush(PAIRING, fetchImpl);

  const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).events;
  expect(sent).toHaveLength(BATCH_SIZE);
  expect(sent[0].client_event_id).toBe("id-0");
  expect(outcome).toMatchObject({ kind: "sent", remaining: 5 });
});

it("keeps every event when the server cannot be reached", async () => {
  await enqueue([event(1), event(2)]);
  const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

  const outcome = await flush(PAIRING, fetchImpl);

  expect(outcome).toMatchObject({ kind: "failed", remaining: 2 });
  expect(await count()).toBe(2);
});

it("keeps every event on a server error", async () => {
  await enqueue([event(1)]);
  const fetchImpl = jest.fn().mockResolvedValue(reply(502, {}));

  expect(await flush(PAIRING, fetchImpl)).toMatchObject({ kind: "failed", remaining: 1 });
  expect(stopTracking).not.toHaveBeenCalled();
});

it("stops tracking when the token is refused", async () => {
  await enqueue([event(1)]);
  const fetchImpl = jest.fn().mockResolvedValue(reply(401, { error: "This device has been unpaired" }));

  expect(await flush(PAIRING, fetchImpl)).toEqual({ kind: "unpaired" });
  expect(stopTracking).toHaveBeenCalled();
  // The queue is the screen's to clear, along with the pairing.
  expect(await count()).toBe(1);
});

it("points the geofences at the returned places while tracking", async () => {
  jest.mocked(isTracking).mockResolvedValue(true);
  await enqueue([event(1)]);

  await flush(PAIRING, answering("accepted"));

  expect(syncGeofences).toHaveBeenCalledWith([
    { id: 7, name: "Office", category: "Work", latitude: -23.5, longitude: -46.6, radiusM: 150 },
  ]);
});

it("leaves the geofences alone while not tracking", async () => {
  await enqueue([event(1)]);

  await flush(PAIRING, answering("accepted"));

  expect(syncGeofences).not.toHaveBeenCalled();
});

it("still reports the send when the geofences cannot be updated", async () => {
  jest.mocked(isTracking).mockResolvedValue(true);
  jest.mocked(syncGeofences).mockRejectedValueOnce(new Error("Not authorized"));
  await enqueue([event(1)]);

  expect(await flush(PAIRING, answering("accepted"))).toMatchObject({ kind: "sent", remaining: 0 });
});

it("joins a flush already running instead of sending twice", async () => {
  await enqueue([event(1)]);
  const fetchImpl = answering("accepted");

  const [a, b] = await Promise.all([flush(PAIRING, fetchImpl), flush(PAIRING, fetchImpl)]);

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);
});
