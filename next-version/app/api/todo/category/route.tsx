import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const flaskRes = await fetch(`${FLASK_BASE_URL}/todo/category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await flaskRes.json();
    return NextResponse.json(data, { status: flaskRes.status });
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return NextResponse.json(
      { error: "Could not reach Flask service" },
      { status: 502 },
    );
  }
}
