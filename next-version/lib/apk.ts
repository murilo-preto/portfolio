import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Finding the Namu Android app's APK to hand to a phone.
 *
 * `mobile/build_apk.sh` writes `namu-<variant>-<versionCode>.apk` into
 * `mobile/dist/`, which compose mounts read-only at NAMU_APK_DIR. Only one
 * variant is offered per deployment (NAMU_APK_VARIANT): the LAN build talks
 * plain HTTP to private addresses, so it must never be what the public site
 * hands out. The prod overlay sets "release".
 */

export type ApkFile = {
  path: string;
  filename: string;
  variant: string;
  versionCode: number;
  size: number;
  builtAt: Date;
};

const VARIANTS = ["lan", "release"] as const;
export type ApkVariant = (typeof VARIANTS)[number];

export function apkVariant(): ApkVariant {
  const value = process.env.NAMU_APK_VARIANT;
  return (VARIANTS as readonly string[]).includes(value ?? "")
    ? (value as ApkVariant)
    : "release";
}

export function apkDir(): string | null {
  return process.env.NAMU_APK_DIR || null;
}

const NAME = /^namu-([a-z]+)-(\d+)\.apk$/;

/** The highest version code of `variant` in `dir`, or null if there is none. */
export async function findLatestApk(
  dir: string | null,
  variant: ApkVariant,
): Promise<ApkFile | null> {
  if (!dir) return null;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }

  let best: { filename: string; versionCode: number } | null = null;
  for (const filename of names) {
    const match = NAME.exec(filename);
    if (!match || match[1] !== variant) continue;
    const versionCode = Number(match[2]);
    if (!best || versionCode > best.versionCode) best = { filename, versionCode };
  }
  if (!best) return null;

  const fullPath = path.join(dir, best.filename);
  try {
    const info = await stat(fullPath);
    if (!info.isFile()) return null;
    return {
      path: fullPath,
      filename: best.filename,
      variant,
      versionCode: best.versionCode,
      size: info.size,
      builtAt: info.mtime,
    };
  } catch {
    return null;
  }
}

/**
 * Where a phone should download from: NAMU_DOWNLOAD_BASE_URL if set (the
 * computer's network address, when the page itself is opened at localhost),
 * otherwise null and the page falls back to its own origin.
 */
export function downloadBaseUrl(): string | null {
  const value = process.env.NAMU_DOWNLOAD_BASE_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export const APK_DOWNLOAD_PATH = "/api/mobile/apk";
