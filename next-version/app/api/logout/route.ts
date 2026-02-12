import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ message: "Logged out" });

  response.cookies.set({
    name: "access_token",
    value: "",
    httpOnly: true,
    expires: new Date(0), // expire immediately
    path: "/",
  });

  return response;
}
