import {
  ApiError,
  fetchDeviceStatus,
  fetchPlaces,
  pairDevice,
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
