import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";
import { clientForwardingHeaders } from "@/lib/proxy-headers";

/**
 * Forward a request from the Namu Android app to Flask.
 *
 * The app has no session cookie. It authenticates with a device token in its
 * own `Authorization: Device <token>` header, so this passes that header
 * through untouched instead of building a Bearer header from a cookie the way
 * fetchWithTokenRefresh does. Flask decides whether the token is any good; a
 * request without one is forwarded as-is and Flask answers 401.
 *
 * The body, when there is one, is forwarded as received. Like every proxy
 * here, nothing is validated on this side.
 */
export async function forwardDeviceRequest(
  req: Request,
  path: string,
  method: "GET" | "POST",
): Promise<NextResponse> {
  const headers: Record<string, string> = {
    ...(await clientForwardingHeaders()),
  };
  const authorization = req.headers.get("authorization");
  if (authorization) headers.Authorization = authorization;

  let body: string | undefined;
  if (method === "POST") {
    body = await req.text();
    if (body) headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(`${FLASK_BASE_URL}${path}`, { method, headers, body });
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return NextResponse.json(
      { error: "Could not reach the server" },
      { status: 502 },
    );
  }

  // Flask answers in JSON, but an infrastructure-level response need not, and
  // parsing it unconditionally would hide the real status. See register.
  try {
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Unexpected response from the server" },
      { status: res.status },
    );
  }
}
