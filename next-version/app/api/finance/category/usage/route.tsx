import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET() {
  return proxyFlaskJson("/finance/category/usage", "GET");
}
