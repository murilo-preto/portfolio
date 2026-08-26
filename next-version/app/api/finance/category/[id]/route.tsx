import { proxyCategoryAdmin } from "@/lib/category-proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyCategoryAdmin(`/finance/category/${id}`, "PUT", req);
}

export async function DELETE(req: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyCategoryAdmin(`/finance/category/${id}`, "DELETE", req);
}
