import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET() {
  return proxyFlaskJson("/category/usage", "GET");
}
