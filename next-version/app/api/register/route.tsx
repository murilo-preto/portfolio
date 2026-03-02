import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(req: Request) {
  const body = await req.json();

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
