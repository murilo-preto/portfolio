import { proxyFlaskJson } from "@/lib/category-proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyFlaskJson(`/devices/${id}/revoke`, "POST", req);
}
