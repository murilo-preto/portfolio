import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

export async function GET() {
  const { response } = await fetchWithTokenRefresh(`${FLASK_BASE_URL}/todo`);
  return response;
}
