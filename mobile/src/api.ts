/**
 * The calls the app makes to the Namu server, all through its Next.js proxy
 * (/api/devices/*). The device token goes in `Authorization: Device <token>`;
 * see flask-server/device_tokens.py for why not Bearer.
 */

export type Pairing = {
  server: string;
  token: string;
  deviceId: number;
  deviceName: string;
  username: string;
};

export type DeviceStatus = {
  id: number;
  name: string;
  username: string;
  createdAt: string | null;
  lastSeenAt: string | null;
};

/** A place the phone should watch. Only enabled places are sent. */
export type WatchedPlace = {
  id: number;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  radiusM: number;
};

/** A failed call. `status` is 0 when the server could not be reached at all. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The token was refused: unknown, or revoked from the phone or the web. */
  get isUnpaired(): boolean {
    return this.status === 401;
  }
}

type Fetch = typeof fetch;

const TIMEOUT_MS = 15_000;

async function call(
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new ApiError("Could not reach the server. Check the address and your connection.", 0);
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // An error page from something in front of the server; the status says enough.
  }

  if (!response.ok) {
    const message =
      typeof body.error === "string" ? body.error : `The server answered ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body;
}

function deviceHeaders(token: string): Record<string, string> {
  return { Authorization: `Device ${token}` };
}

export async function pairDevice(
  server: string,
  credentials: { username: string; password: string; deviceName: string },
  fetchImpl: Fetch = fetch,
): Promise<Pairing> {
  const body = await call(fetchImpl, `${server}/api/devices/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      device_name: credentials.deviceName,
    }),
  });
  return {
    server,
    token: String(body.token),
    deviceId: Number(body.device_id),
    deviceName: String(body.name),
    username: String(body.username),
  };
}

export async function fetchDeviceStatus(
  pairing: Pairing,
  fetchImpl: Fetch = fetch,
): Promise<DeviceStatus> {
  const body = await call(fetchImpl, `${pairing.server}/api/devices/me`, {
    method: "GET",
    headers: deviceHeaders(pairing.token),
  });
  return {
    id: Number(body.id),
    name: String(body.name),
    username: String(body.username),
    createdAt: typeof body.created_at === "string" ? body.created_at : null,
    lastSeenAt: typeof body.last_seen_at === "string" ? body.last_seen_at : null,
  };
}

export async function fetchPlaces(
  pairing: Pairing,
  fetchImpl: Fetch = fetch,
): Promise<WatchedPlace[]> {
  const body = await call(fetchImpl, `${pairing.server}/api/devices/me/places`, {
    method: "GET",
    headers: deviceHeaders(pairing.token),
  });
  const places = Array.isArray(body.places) ? (body.places as Record<string, unknown>[]) : [];
  return places.map((place) => ({
    id: Number(place.id),
    name: String(place.name),
    category: String(place.category),
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
    radiusM: Number(place.radius_m),
  }));
}

export async function unpairDevice(pairing: Pairing, fetchImpl: Fetch = fetch): Promise<void> {
  await call(fetchImpl, `${pairing.server}/api/devices/me/revoke`, {
    method: "POST",
    headers: deviceHeaders(pairing.token),
  });
}
