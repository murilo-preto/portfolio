import { proxyFlaskJson } from "@/lib/category-proxy";

export async function GET() {
  return proxyFlaskJson("/places", "GET");
}

export async function POST(req: Request) {
  return proxyFlaskJson("/places", "POST", req);
}
