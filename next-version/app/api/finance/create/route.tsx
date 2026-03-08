import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let flaskRes: Response;

  try {
    flaskRes = await fetch(`${FLASK_BASE_URL}/finance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return NextResponse.json(
      { error: "Could not reach Flask service" },
      { status: 502 },
    );
  }

  const data = await flaskRes.json();
  return NextResponse.json(data, { status: flaskRes.status });
}
