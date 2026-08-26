import { NextResponse } from "next/server";
import { fetchWithTokenRefresh } from "@/lib/flask-client";
import { FLASK_BASE_URL } from "@/lib/constants";

/**
 * Shared plumbing for the category rename/delete/merge proxies.
 *
 * There are three category namespaces (time, finance, TODO) and four routes
 * each, all of them the same thin forward: take the JSON body if there is one,
 * attach the access token, hand Flask's answer back untouched so the UI sees
 * the real 400/404/409 and the message that came with it.
 */
export async function proxyCategoryAdmin(
  flaskPath: string,
  method: "GET" | "PUT" | "POST" | "DELETE",
  req?: Request,
): Promise<Response> {
  let body: string | undefined;

  if (req && method !== "GET") {
    // DELETE carries an optional { reassign_to } and may legitimately arrive
    // with no body at all, so an unparseable one is only an error when the
    // request actually sent something.
    const raw = (await req.text()).trim();
    if (raw) {
      try {
        JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      body = raw;
    }
  }

  try {
    const { response } = await fetchWithTokenRefresh(
      `${FLASK_BASE_URL}${flaskPath}`,
      {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body } : {}),
      },
    );
    return response;
  } catch (err) {
    console.error("Failed to reach Flask:", err);
    return NextResponse.json(
      { error: "Could not reach Flask service" },
      { status: 502 },
    );
  }
}
