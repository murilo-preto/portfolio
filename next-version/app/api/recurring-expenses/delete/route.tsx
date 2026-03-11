import { NextResponse } from "next/server";
import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { response } = await fetchWithTokenRefresh(`${FLASK_BASE_URL}/recurring-expenses/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return response;
  } catch (error) {
    console.error("Error deleting recurring expense:", error);
    return NextResponse.json({ error: "Failed to delete recurring expense" }, { status: 500 });
  }
}
