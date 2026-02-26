import { NextResponse } from "next/server";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let flaskRes: Response;
  try {
    flaskRes = await fetch("http://flask:3000/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
