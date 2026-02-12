import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();

  let res: Response;
  try {
    res = await fetch("http://flask:3000/login", {
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

  if (!res.ok || !data.access_token) {
    return NextResponse.json(
      { error: data.message || "Login failed" },
      { status: res.status },
    );
  }

  const response = NextResponse.json(
    {
      authenticated: true,
      user_id: data.user_id,
      username: data.username,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: "access_token",
    value: data.access_token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return response;
}
