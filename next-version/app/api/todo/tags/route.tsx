import { proxyFlaskJson } from "@/lib/category-proxy";

// Authenticated since the lookup tables were scoped per user: this listing
// returns only the caller's rows, so it needs their token to know who that is.
export async function GET() {
  return proxyFlaskJson("/todo/tags", "GET");
}
