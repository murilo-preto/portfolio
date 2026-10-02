import { forwardDeviceRequest } from "@/lib/device-proxy";

export async function POST(req: Request) {
  return forwardDeviceRequest(req, "/devices/me/revoke", "POST");
}
