import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { apkDir, apkVariant, findLatestApk } from "@/lib/apk";

// The newest Namu APK, for a phone that scanned the QR code on the Namu app
// page. Public on purpose: the phone is not logged in, and the APK holds no
// secret (pairing still needs the account's password).

export const dynamic = "force-dynamic";

export async function GET() {
  const apk = await findLatestApk(apkDir(), apkVariant());
  if (!apk) {
    return NextResponse.json({ error: "No APK has been built yet" }, { status: 404 });
  }

  const body = Readable.toWeb(createReadStream(apk.path)) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(apk.size),
      "Content-Disposition": `attachment; filename="${apk.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
