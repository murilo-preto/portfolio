import { proxyCategoryAdmin } from "@/lib/category-proxy";

export async function GET() {
  return proxyCategoryAdmin("/category/usage", "GET");
}
