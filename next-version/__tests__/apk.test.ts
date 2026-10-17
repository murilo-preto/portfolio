/**
 * Serving the Namu APK to a phone: picking the newest build of the configured
 * variant from mobile/dist, and the two public routes that describe and
 * stream it. Uses a real temporary directory, so no fs mocking.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apkVariant, downloadBaseUrl, findLatestApk } from "@/lib/apk";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "namu-apk-"));
  delete process.env.NAMU_APK_DIR;
  delete process.env.NAMU_APK_VARIANT;
  delete process.env.NAMU_DOWNLOAD_BASE_URL;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(name: string, bytes = 3) {
  await writeFile(path.join(dir, name), Buffer.alloc(bytes, 1));
}

describe("findLatestApk", () => {
  it("picks the highest version code, compared as a number", async () => {
    await put("namu-lan-99.apk");
    await put("namu-lan-136.apk", 7);
    await put("namu-lan-132.apk");

    const apk = await findLatestApk(dir, "lan");

    expect(apk).toMatchObject({
      filename: "namu-lan-136.apk",
      variant: "lan",
      versionCode: 136,
      size: 7,
      path: path.join(dir, "namu-lan-136.apk"),
    });
  });

  it("never hands out the other variant", async () => {
    await put("namu-lan-200.apk");
    await put("namu-release-150.apk");

    expect((await findLatestApk(dir, "release"))?.filename).toBe("namu-release-150.apk");
    expect((await findLatestApk(dir, "lan"))?.filename).toBe("namu-lan-200.apk");
  });

  it("never hands a phone the emulator's x86_64 build", async () => {
    await put("namu-lan-136.apk");
    await put("namu-lan-140-x86_64.apk");

    expect((await findLatestApk(dir, "lan"))?.filename).toBe("namu-lan-136.apk");
  });

  it("ignores anything not named like a build", async () => {
    await put("namu-lan-latest.apk");
    await put("namu-lan-5.apk.tmp");
    await put("other-lan-9.apk");
    await mkdir(path.join(dir, "namu-lan-300.apk"));

    expect(await findLatestApk(dir, "lan")).toBeNull();
  });

  it("is null with no directory, or one that does not exist", async () => {
    expect(await findLatestApk(null, "lan")).toBeNull();
    expect(await findLatestApk(path.join(dir, "missing"), "lan")).toBeNull();
  });
});

describe("configuration", () => {
  it("defaults to the release variant, and refuses anything unknown", () => {
    expect(apkVariant()).toBe("release");
    process.env.NAMU_APK_VARIANT = "debug";
    expect(apkVariant()).toBe("release");
    process.env.NAMU_APK_VARIANT = "lan";
    expect(apkVariant()).toBe("lan");
  });

  it("trims the download base URL and its trailing slashes", () => {
    expect(downloadBaseUrl()).toBeNull();
    process.env.NAMU_DOWNLOAD_BASE_URL = "  ";
    expect(downloadBaseUrl()).toBeNull();
    process.env.NAMU_DOWNLOAD_BASE_URL = " http://192.168.7.16:5000// ";
    expect(downloadBaseUrl()).toBe("http://192.168.7.16:5000");
  });
});

describe("GET /api/mobile/apk/info", () => {
  it("describes the newest build and the address for the QR code", async () => {
    await put("namu-lan-136.apk", 5);
    process.env.NAMU_APK_DIR = dir;
    process.env.NAMU_APK_VARIANT = "lan";
    process.env.NAMU_DOWNLOAD_BASE_URL = "http://192.168.7.16:5000/";

    const { GET } = await import("@/app/api/mobile/apk/info/route");
    const body = await (await GET()).json();

    expect(body).toMatchObject({
      apk: { filename: "namu-lan-136.apk", variant: "lan", version_code: 136, size: 5 },
      download_path: "/api/mobile/apk",
      download_url: "http://192.168.7.16:5000/api/mobile/apk",
    });
    expect(Number.isNaN(Date.parse(body.apk.built_at))).toBe(false);
  });

  it("has no APK and no URL when nothing is configured", async () => {
    const { GET } = await import("@/app/api/mobile/apk/info/route");
    expect(await (await GET()).json()).toEqual({
      apk: null,
      download_path: "/api/mobile/apk",
      download_url: null,
    });
  });
});

describe("GET /api/mobile/apk", () => {
  it("streams the newest build as an Android package", async () => {
    await put("namu-lan-132.apk", 2);
    await put("namu-lan-136.apk", 4);
    process.env.NAMU_APK_DIR = dir;
    process.env.NAMU_APK_VARIANT = "lan";

    const { GET } = await import("@/app/api/mobile/apk/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.android.package-archive");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="namu-lan-136.apk"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 1, 1, 1]));
  });

  it("is a 404 when no build of the variant exists", async () => {
    await put("namu-lan-136.apk");
    process.env.NAMU_APK_DIR = dir;

    const { GET } = await import("@/app/api/mobile/apk/route");
    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No APK has been built yet" });
  });
});
