import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}/finance/batch-import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    
    return response;
  } catch (error) {
    console.error("Finance batch import error:", error);
    return Response.json(
      { error: "Failed to import finance entries" },
      { status: 500 }
    );
  }
}
