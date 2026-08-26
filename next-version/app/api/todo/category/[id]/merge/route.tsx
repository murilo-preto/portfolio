import { proxyCategoryAdmin } from "@/lib/category-proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCategoryAdmin(`/todo/category/${id}/merge`, "POST", req);
}
