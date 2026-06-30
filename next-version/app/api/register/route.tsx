import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${FLASK_BASE_URL}/register`, {
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

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
