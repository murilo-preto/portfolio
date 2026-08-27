import { NextResponse } from "next/server";
import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Flask's /category is @jwt_required(). A bare fetch() from a route handler
  // carries none of the browser's cookies, so this has to go through
  // fetchWithTokenRefresh like its finance and todo counterparts do.
  const { response } = await fetchWithTokenRefresh(`${FLASK_BASE_URL}/category`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return response;
}
