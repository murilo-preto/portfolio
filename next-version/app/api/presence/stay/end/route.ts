import { proxyFlaskJson } from "@/lib/category-proxy";

export async function POST(req: Request) {
  return proxyFlaskJson("/presence/stay/end", "POST", req);
}
