import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies(); // ← important

  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log(token);

  const flaskRes = await fetch("http://flask:3000/get/entries", {
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
