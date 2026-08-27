import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function GET(req: Request) {
  // Forwarded verbatim so filtering, sorting and paging happen in MySQL rather
  // than after the whole table has crossed the wire. Flask validates; anything
  // it does not recognise it ignores.
  const { search } = new URL(req.url);
  const { response } = await fetchWithTokenRefresh(
    `${FLASK_BASE_URL}/entry${search}`,
  );
  return response;
}
