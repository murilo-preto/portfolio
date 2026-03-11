import { cookies } from "next/headers";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function GET() {
  const cookieStore = await cookies();

  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const flaskRes = await fetch(`${FLASK_BASE_URL}/protected`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!flaskRes.ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await flaskRes.json();
  return Response.json(data);
}
