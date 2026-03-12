import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}/recurring-expenses/batch-import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    
    return response;
  } catch (error) {
    console.error("Recurring expenses batch import error:", error);
    return Response.json(
      { error: "Failed to import recurring expenses" },
      { status: 500 }
    );
  }
}
