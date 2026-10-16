import { proxyFlaskJson } from "@/lib/category-proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyFlaskJson(`/places/${id}`, "PATCH", req);
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyFlaskJson(`/places/${id}`, "DELETE", req);
}
