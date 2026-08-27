import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";

/** What Flask's /login returns — the error field on the failure path. */
type LoginResponse = {
  access_token?: string;
  user_id?: number;
  username?: string;
  error?: string;
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${FLASK_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return NextResponse.json(
      { error: "Could not reach auth service" },
      { status: 502 },
    );
  }

  // Flask normally answers in JSON, but an infrastructure-level response (a
  // proxy error page, an empty 502) need not. Parsing unconditionally turned
  // those into a blank 500 and hid the real status from the caller.
  let data: LoginResponse;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      { error: "Unexpected response from auth service" },
      { status: res.status },
    );
  }

  if (!res.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.error || "Login failed" },
      { status: res.status },
    );
  }

  const response = NextResponse.json(
    {
      authenticated: true,
      user_id: data.user_id,
      username: data.username,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: "access_token",
    value: data.access_token,
    httpOnly: true,
    secure: false, // Allow cookie over HTTP in development/Docker
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 48, // 48 hours to match TOKEN_DURATION_HOURS
  });

  return response;
}
