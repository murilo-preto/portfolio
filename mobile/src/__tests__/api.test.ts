import {
  ApiError,
  fetchDeviceStatus,
  fetchPlaces,
  fetchStay,
  pairDevice,
  postEvents,
  unpairDevice,
  type Pairing,
} from "../api";

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function notJson(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  } as unknown as Response;
}

const PAIRING: Pairing = {
  server: "https://namu.example",
  token: "namu_dev_abc",
  deviceId: 3,
  deviceName: "Pixel 8",
  username: "alice",
};

describe("pairDevice", () => {
  it("posts the credentials and returns the pairing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(201, { device_id: 3, name: "Pixel 8", username: "alice", token: "namu_dev_abc" }),
    );

    const pairing = await pairDevice(
      "https://namu.example",
      { username: "alice", password: "pw", deviceName: "Pixel 8" },
      fetchImpl,
    );

    expect(pairing).toEqual(PAIRING);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/pair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ username: "alice", password: "pw", device_name: "Pixel 8" });
  });

  it("surfaces the server's error message", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(401, { error: "Invalid username or password" }));

    await expect(
      pairDevice("https://namu.example", { username: "a", password: "b", deviceName: "c" }, fetchImpl),
    ).rejects.toMatchObject({ message: "Invalid username or password", status: 401 });
  });

  it("reports an unreachable server as status 0", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

    const error = await pairDevice(
      "https://namu.example",
      { username: "a", password: "b", deviceName: "c" },
      fetchImpl,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
  });

  it("keeps the status when the body is not JSON", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(notJson(502));

    await expect(
      pairDevice("https://namu.example", { username: "a", password: "b", deviceName: "c" }, fetchImpl),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("device-token calls", () => {
  it("sends the token in a Device authorization header", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(200, { id: 3, name: "Pixel 8", username: "alice", created_at: "2026-10-02T18:13:05+00:00", last_seen_at: null }),
    );

    const status = await fetchDeviceStatus(PAIRING, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/me");
    expect(init.headers).toEqual({ Authorization: "Device namu_dev_abc" });
    expect(status).toMatchObject({ id: 3, username: "alice", lastSeenAt: null });
  });

  it("marks a refused token as unpaired", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(401, { error: "This device has been unpaired" }));

    const error = (await fetchDeviceStatus(PAIRING, fetchImpl).catch((e: unknown) => e)) as ApiError;

    expect(error.isUnpaired).toBe(true);
    expect(error.message).toBe("This device has been unpaired");
  });

  it("unpairs with a POST to the revoke route", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { message: "Device unpaired" }));

    await unpairDevice(PAIRING, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/me/revoke");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Device namu_dev_abc" });
  });

  it("does not treat a server error as unpaired", async () => {
    // Only a 401 may make the app forget its token; a 500 or an outage must not.
    const fetchImpl = jest.fn().mockResolvedValue(reply(500, { error: "boom" }));

    const error = (await fetchDeviceStatus(PAIRING, fetchImpl).catch((e: unknown) => e)) as ApiError;

    expect(error.isUnpaired).toBe(false);
  });
});

describe("fetchPlaces", () => {
  it("asks for the device's places with its token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { places: [] }));

    await fetchPlaces(PAIRING, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/me/places");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Device namu_dev_abc" });
  });

  it("maps the server's places to the app's shape", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(200, {
        places: [
          {
            id: 4,
            name: "Office",
            category_id: 9,
            category: "Work",
            latitude: -23.561414,
            longitude: -46.655881,
            radius_m: 150,
            enabled: true,
          },
        ],
      }),
    );

    expect(await fetchPlaces(PAIRING, fetchImpl)).toEqual([
      {
        id: 4,
        name: "Office",
        category: "Work",
        latitude: -23.561414,
        longitude: -46.655881,
        radiusM: 150,
      },
    ]);
  });

  it("treats a reply without a list as no places", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, {}));
    expect(await fetchPlaces(PAIRING, fetchImpl)).toEqual([]);
  });

  it("marks a refused token as unpaired", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(401, { error: "This device has been unpaired" }),
    );

    const error = (await fetchPlaces(PAIRING, fetchImpl).catch((e: unknown) => e)) as ApiError;

    expect(error.isUnpaired).toBe(true);
  });
});

describe("postEvents", () => {
  it("sends the events in the server's snake_case shape", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { results: [], stay: null, places: [] }));

    await postEvents(
      PAIRING,
      [
        {
          clientEventId: "0b7c1e2a-3f4d-4e5f-8a9b-0c1d2e3f4a5b",
          placeId: 7,
          kind: "enter",
          occurredAt: "2026-10-16T08:59:30.123Z",
        },
      ],
      fetchImpl,
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/me/events");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Device namu_dev_abc",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      events: [
        {
          client_event_id: "0b7c1e2a-3f4d-4e5f-8a9b-0c1d2e3f4a5b",
          place_id: 7,
          kind: "enter",
          occurred_at: "2026-10-16T08:59:30.123Z",
        },
      ],
    });
  });

  it("maps the results, the stay and the places", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(200, {
        results: [
          { client_event_id: "a", status: "accepted" },
          { client_event_id: "b", status: "rejected", error: "Unknown place" },
        ],
        stay: {
          place_id: 7,
          place_name: "Office",
          started_at: "2026-10-16T08:59:30+00:00",
          departed_at: null,
        },
        places: [
          { id: 7, name: "Office", category: "Work", latitude: 1, longitude: 2, radius_m: 150 },
        ],
      }),
    );

    expect(await postEvents(PAIRING, [], fetchImpl)).toEqual({
      results: [
        { clientEventId: "a", status: "accepted" },
        { clientEventId: "b", status: "rejected", error: "Unknown place" },
      ],
      stay: {
        placeId: 7,
        placeName: "Office",
        startedAt: "2026-10-16T08:59:30+00:00",
        departedAt: null,
      },
      places: [{ id: 7, name: "Office", category: "Work", latitude: 1, longitude: 2, radiusM: 150 }],
    });
  });

  it("marks a refused token as unpaired", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(401, { error: "This device has been unpaired" }));

    const error = (await postEvents(PAIRING, [], fetchImpl).catch((e: unknown) => e)) as ApiError;

    expect(error.isUnpaired).toBe(true);
  });
});

describe("fetchStay", () => {
  it("asks for the stay with the device's token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { stay: null }));

    expect(await fetchStay(PAIRING, fetchImpl)).toBeNull();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://namu.example/api/devices/me/stay");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: "Device namu_dev_abc" });
  });

  it("maps a stay that is waiting out a departure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(200, {
        stay: {
          place_id: 8,
          place_name: "Gym",
          started_at: "2026-10-16T18:00:00+00:00",
          departed_at: "2026-10-16T19:02:10+00:00",
        },
      }),
    );

    expect(await fetchStay(PAIRING, fetchImpl)).toEqual({
      placeId: 8,
      placeName: "Gym",
      startedAt: "2026-10-16T18:00:00+00:00",
      departedAt: "2026-10-16T19:02:10+00:00",
    });
  });
});
