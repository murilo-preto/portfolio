import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}/entry/batch-import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    
    return response;
  } catch (error) {
    console.error("Batch import error:", error);
    return Response.json(
      { error: "Failed to import entries" },
      { status: 500 }
    );
  }
}
