import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET() {
  return proxyFlaskJson("/todo/category/usage", "GET");
}
