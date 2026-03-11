import { NextResponse } from "next/server";
import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { response } = await fetchWithTokenRefresh(`${FLASK_BASE_URL}/recurring-expenses/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return response;
  } catch (error) {
    console.error("Error updating recurring expense:", error);
    return NextResponse.json({ error: "Failed to update recurring expense" }, { status: 500 });
  }
}
