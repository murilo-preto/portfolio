import { proxyCategoryAdmin } from "@/lib/category-proxy";

export async function GET() {
  return proxyCategoryAdmin("/finance/category/usage", "GET");
}
