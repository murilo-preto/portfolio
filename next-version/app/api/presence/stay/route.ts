import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET() {
  return proxyFlaskJson("/presence/stay", "GET");
}
