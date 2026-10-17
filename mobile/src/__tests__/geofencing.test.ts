import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import type { Pairing, WatchedPlace } from "../api";
import {
  GEOFENCE_TASK,
  eventsFromTask,
  handleGeofenceTask,
  isTracking,
  locationAccuracyOn,
  requestPermissions,
  startTracking,
  stopTracking,
  syncGeofences,
  turnOnLocationAccuracy,
} from "../geofencing";
import { take } from "../queue";
import { loadPairing } from "../storage";
import { flush } from "../sync";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("expo-location", () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  startGeofencingAsync: jest.fn(async () => undefined),
  stopGeofencingAsync: jest.fn(async () => undefined),
  hasStartedGeofencingAsync: jest.fn(async () => false),
  getProviderStatusAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));

jest.mock("expo-crypto", () => {
  let n = 0;
  const { createHash } = jest.requireActual("crypto");
  return {
    randomUUID: jest.fn(() => `uuid-${++n}`),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
      createHash("sha256").update(data).digest("hex"),
    ),
  };
});

jest.mock("../storage", () => ({ loadPairing: jest.fn() }));
jest.mock("../sync", () => ({ flush: jest.fn(async () => ({ kind: "empty" })) }));

const PAIRING: Pairing = {
  server: "https://namu.example",
  token: "namu_dev_abc",
  deviceId: 3,
  deviceName: "Pixel 8",
  username: "alice",
};

const OFFICE: WatchedPlace = {
  id: 7,
  name: "Office",
  category: "Work",
  latitude: -23.5,
  longitude: -46.6,
  radiusM: 150,
};
const HOME: WatchedPlace = { ...OFFICE, id: 8, name: "Home", latitude: -23.6 };

const location = jest.mocked(Location);

function region(identifier: string): Location.LocationRegion {
  return { identifier, latitude: 0, longitude: 0, radius: 150 };
}

function taskBody(data: unknown, error: TaskManager.TaskManagerError | null = null) {
  return { data, error, executionInfo: { eventId: "e", taskName: GEOFENCE_TASK } };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  location.hasStartedGeofencingAsync.mockResolvedValue(false);
});

describe("the geofencing task", () => {
  it("is defined when the module loads", () => {
    // index.ts imports this module first; Android drops a task not yet defined.
    jest.isolateModules(() => {
      const isolated = require("expo-task-manager") as typeof TaskManager;
      const { handleGeofenceTask: handler } = require("../geofencing");
      expect(isolated.defineTask).toHaveBeenCalledWith("namu-geofence", handler);
    });
  });

  it("turns a crossing into an event", () => {
    const now = new Date("2026-10-16T08:59:30.123Z");

    expect(eventsFromTask({ eventType: 1, region: region("7") }, now, () => "u1")).toEqual([
      { clientEventId: "u1", placeId: 7, kind: "enter", occurredAt: "2026-10-16T08:59:30.123Z" },
    ]);
    expect(eventsFromTask({ eventType: 2, region: region("7") }, now, () => "u2")).toEqual([
      { clientEventId: "u2", placeId: 7, kind: "exit", occurredAt: "2026-10-16T08:59:30.123Z" },
    ]);
  });

  it.each([
    ["a region that is not a place id", { eventType: 1, region: region("not-ours") }],
    ["an unknown event type", { eventType: 9, region: region("7") }],
    ["no region", { eventType: 1 }],
    ["no data", null],
  ])("ignores %s", (_, data) => {
    expect(eventsFromTask(data)).toEqual([]);
  });

  it("queues the event, then sends it", async () => {
    jest.mocked(loadPairing).mockResolvedValue(PAIRING);

    await handleGeofenceTask(taskBody({ eventType: 1, region: region("7") }));

    const queued = await take(10);
    expect(queued).toEqual([
      expect.objectContaining({ placeId: 7, kind: "enter", clientEventId: expect.any(String) }),
    ]);
    expect(Number.isNaN(Date.parse(queued[0].occurredAt))).toBe(false);
    expect(flush).toHaveBeenCalledWith(PAIRING);
  });

  it("keeps the event without sending when the phone is not paired", async () => {
    jest.mocked(loadPairing).mockResolvedValue(null);

    await handleGeofenceTask(taskBody({ eventType: 2, region: region("7") }));

    expect(await take(10)).toHaveLength(1);
    expect(flush).not.toHaveBeenCalled();
  });

  it("does nothing on a task error", async () => {
    await handleGeofenceTask(taskBody(null, { code: 1, message: "GEOFENCE_NOT_AVAILABLE" }));

    expect(await take(10)).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("syncGeofences", () => {
  it("watches each place, identified by its id", async () => {
    await syncGeofences([OFFICE]);

    expect(location.startGeofencingAsync).toHaveBeenCalledWith("namu-geofence", [
      {
        identifier: "7",
        latitude: -23.5,
        longitude: -46.6,
        radius: 150,
        notifyOnEnter: true,
        notifyOnExit: true,
      },
    ]);
  });

  it("keeps no coordinates in the app's own storage", async () => {
    await syncGeofences([OFFICE, HOME]);

    const stored = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    const everything = JSON.stringify(stored);
    expect(everything).not.toContain("23.5");
    expect(everything).not.toContain("46.6");
    expect(await AsyncStorage.getItem("namu.geofenceSignature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not restart for the same places", async () => {
    await syncGeofences([OFFICE, HOME]);
    location.hasStartedGeofencingAsync.mockResolvedValue(true);

    // Order is not a change.
    await syncGeofences([HOME, OFFICE]);

    expect(location.startGeofencingAsync).toHaveBeenCalledTimes(1);
  });

  it("restarts when a place changes", async () => {
    await syncGeofences([OFFICE]);
    location.hasStartedGeofencingAsync.mockResolvedValue(true);

    await syncGeofences([{ ...OFFICE, radiusM: 300 }]);

    expect(location.startGeofencingAsync).toHaveBeenCalledTimes(2);
  });

  it("restarts the same places when the geofences are gone, as after a reboot", async () => {
    await syncGeofences([OFFICE]);
    location.hasStartedGeofencingAsync.mockResolvedValue(false);

    await syncGeofences([OFFICE]);

    expect(location.startGeofencingAsync).toHaveBeenCalledTimes(2);
  });

  it("stops watching when there are no places", async () => {
    await syncGeofences([OFFICE]);
    location.hasStartedGeofencingAsync.mockResolvedValue(true);

    await syncGeofences([]);

    expect(location.stopGeofencingAsync).toHaveBeenCalledWith("namu-geofence");
  });
});

describe("permissions and tracking", () => {
  function grant(foreground: boolean, background: boolean) {
    location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: foreground } as never);
    location.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: background } as never);
  }

  it("asks for the foreground first, then the background", async () => {
    grant(true, true);
    expect(await requestPermissions()).toBe("granted");

    grant(false, true);
    expect(await requestPermissions()).toBe("foreground-denied");
    expect(location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);

    grant(true, false);
    expect(await requestPermissions()).toBe("background-denied");
  });

  it("starts only with both permissions", async () => {
    grant(true, false);

    expect(await startTracking([OFFICE])).toBe("background-denied");
    expect(await isTracking()).toBe(false);
    expect(location.startGeofencingAsync).not.toHaveBeenCalled();
  });

  it("starts, then stops", async () => {
    grant(true, true);

    expect(await startTracking([OFFICE])).toBe("granted");
    expect(await isTracking()).toBe(true);
    expect(location.startGeofencingAsync).toHaveBeenCalled();

    location.hasStartedGeofencingAsync.mockResolvedValue(true);
    await stopTracking();
    expect(await isTracking()).toBe(false);
    expect(location.stopGeofencingAsync).toHaveBeenCalledWith("namu-geofence");
  });

  it("stays on with no places to watch yet", async () => {
    grant(true, true);

    await startTracking([]);

    expect(await isTracking()).toBe(true);
    expect(location.startGeofencingAsync).not.toHaveBeenCalled();
  });
});

describe("Location Accuracy", () => {
  const status = (locationServicesEnabled: boolean, networkAvailable?: boolean) => ({
    locationServicesEnabled,
    networkAvailable,
    gpsAvailable: true,
    passiveAvailable: true,
    backgroundModeEnabled: true,
  });

  it("is on when location and the network provider both are", async () => {
    location.getProviderStatusAsync.mockResolvedValue(status(true, true));
    expect(await locationAccuracyOn()).toBe(true);
  });

  it("is off when the network provider is, which is what the setting controls", async () => {
    location.getProviderStatusAsync.mockResolvedValue(status(true, false));
    expect(await locationAccuracyOn()).toBe(false);
  });

  it("is off when location itself is", async () => {
    location.getProviderStatusAsync.mockResolvedValue(status(false, true));
    expect(await locationAccuracyOn()).toBe(false);
  });

  it("is off when the network provider is not reported at all", async () => {
    location.getProviderStatusAsync.mockResolvedValue(status(true));
    expect(await locationAccuracyOn()).toBe(false);
  });

  it("is unknown when the status cannot be read", async () => {
    location.getProviderStatusAsync.mockRejectedValue(new Error("no"));
    expect(await locationAccuracyOn()).toBeNull();
  });

  it("asks Android to turn it on, and reports the result", async () => {
    location.getProviderStatusAsync.mockResolvedValue(status(true, true));

    expect(await turnOnLocationAccuracy()).toBe(true);
    expect(location.enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
  });

  it("is false when the dialog is declined", async () => {
    location.enableNetworkProviderAsync.mockRejectedValueOnce(new Error("declined"));

    expect(await turnOnLocationAccuracy()).toBe(false);
    expect(location.getProviderStatusAsync).not.toHaveBeenCalled();
  });
});
