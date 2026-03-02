import { FLASK_BASE_URL } from "@/lib/constants";

export async function GET() {
  let flaskRes: Response;

  try {
    flaskRes = await fetch(`${FLASK_BASE_URL}/get/categories`);
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return Response.json(
      { error: "Could not reach Flask service" },
      { status: 502 },
    );
  }

  if (!flaskRes.ok) {
    return Response.json(
      { error: "Failed to fetch categories" },
      { status: flaskRes.status },
    );
  }

  const data = await flaskRes.json();
  return Response.json(data);
}
