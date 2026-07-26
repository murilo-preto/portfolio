import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const incoming = await request.formData();
    const files = incoming.getAll("file").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return Response.json(
        { error: "At least one PDF file is required" },
        { status: 400 }
      );
    }

    // Rebuild the form data so fetch sets its own multipart boundary.
    const forwarded = new FormData();
    for (const file of files) {
      forwarded.append("file", file, file.name);
    }

    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}/finance/parse-itau-pdf`,
      {
        method: "POST",
        body: forwarded,
      }
    );

    return response;
  } catch (error) {
    console.error("Itau PDF parse error:", error);
    return Response.json(
      { error: "Failed to parse the PDF statement" },
      { status: 500 }
    );
  }
}
