import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    flaskRes = await fetch(`http://flask:3000/entry/${id}`, {
      method: "PUT",
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
