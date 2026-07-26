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

  try {
    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}/finance/bulk-delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    return response;
  } catch (err) {
    console.error("Finance bulk delete error:", err);
    return NextResponse.json(
      { error: "Failed to delete finance entries" },
      { status: 500 }
    );
  }
}
