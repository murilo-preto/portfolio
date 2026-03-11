import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "./constants";

/**
 * Fetches from Flask with the current access token and handles token refresh.
 * If Flask refreshes the token, updates the browser cookie.
 */
export async function fetchWithTokenRefresh(
  url: string,
  options: RequestInit = {}
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ok: false,
    };
  }

  const flaskRes = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  // Create response
  let response: NextResponse;
  try {
    const data = await flaskRes.json();
    response = NextResponse.json(data, { status: flaskRes.status });
  } catch {
    response = NextResponse.json({}, { status: flaskRes.status });
  }

  // Check if Flask sent a refreshed token in Set-Cookie header
  const setCookie = flaskRes.headers.get("Set-Cookie");
  if (setCookie) {
    const match = setCookie.match(/access_token=([^;]+)/);
    if (match && match[1]) {
      response.cookies.set({
        name: "access_token",
        value: match[1],
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 48,
      });
    }
  }

  return {
    response,
    ok: flaskRes.ok,
  };
}
