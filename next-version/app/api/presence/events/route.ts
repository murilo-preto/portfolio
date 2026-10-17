import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET(req: Request) {
  return proxyFlaskJson(`/presence/events${new URL(req.url).search}`, "GET");
}
