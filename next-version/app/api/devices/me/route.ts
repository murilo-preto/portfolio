import { forwardDeviceRequest } from "@/lib/device-proxy";

export async function GET(req: Request) {
  return forwardDeviceRequest(req, "/devices/me", "GET");
}
