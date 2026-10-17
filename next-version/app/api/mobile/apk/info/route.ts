import { NextResponse } from "next/server";
import {
  APK_DOWNLOAD_PATH,
  apkDir,
  apkVariant,
  downloadBaseUrl,
  findLatestApk,
} from "@/lib/apk";

// What the Namu app page needs to draw its QR code: which APK a phone would
// get, and the address to put in the code when one is configured.

export const dynamic = "force-dynamic";

export async function GET() {
  const apk = await findLatestApk(apkDir(), apkVariant());
  const base = downloadBaseUrl();

  return NextResponse.json({
    apk: apk && {
      filename: apk.filename,
      variant: apk.variant,
      version_code: apk.versionCode,
      size: apk.size,
      built_at: apk.builtAt.toISOString(),
    },
    download_path: APK_DOWNLOAD_PATH,
    download_url: base ? `${base}${APK_DOWNLOAD_PATH}` : null,
  });
}
