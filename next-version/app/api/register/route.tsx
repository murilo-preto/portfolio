import { NextResponse } from "next/server";
import { FLASK_BASE_URL } from "@/lib/constants";
import { clientForwardingHeaders } from "@/lib/proxy-headers";

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
      headers: {
        "Content-Type": "application/json",
        ...(await clientForwardingHeaders()),
      },
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
  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json(
      { error: "Unexpected response from auth service" },
      { status: res.status },
    );
  }

  return NextResponse.json(data, { status: res.status });
}
