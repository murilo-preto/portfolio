export async function GET() {
  let flaskRes: Response;

  try {
    flaskRes = await fetch("http://flask:3000/categories");
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
