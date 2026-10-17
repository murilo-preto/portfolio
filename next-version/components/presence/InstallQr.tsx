"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { warmFetch } from "@/lib/prefetch";

/** What `/api/mobile/apk/info` answers. */
type ApkInfo = {
  apk: {
    filename: string;
    variant: "lan" | "release";
    version_code: number;
    size: number;
    built_at: string;
  } | null;
  download_path: string;
  download_url: string | null;
};

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/** The configured address, or this page's own origin when there is none. */
function resolveUrl(info: ApkInfo): string {
  return info.download_url ?? `${window.location.origin}${info.download_path}`;
}

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * A QR code a phone scans to download the newest Namu APK. Locally the phone
 * cannot reach "localhost", so the code carries NAMU_DOWNLOAD_BASE_URL when it
 * is set, and the section says so when the address would not work.
 */
export function InstallQr() {
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await warmFetch("/api/mobile/apk/info");
        if (!res.ok) throw new Error();
        const data: ApkInfo = await res.json();
        setInfo(data);
        if (!data.apk) return;
        const target = resolveUrl(data);
        setUrl(target);
        // Black on white whatever the theme: phone cameras read a light-on-dark
        // code poorly.
        setSvg(
          await QRCode.toString(target, {
            type: "svg",
            margin: 2,
            errorCorrectionLevel: "M",
            color: { dark: "#000000", light: "#ffffff" },
          }),
        );
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  if (failed) {
    return <p className="text-sm text-red-500">Failed to look up the app download.</p>;
  }
  if (!info) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  if (!info.apk) {
    return (
      <div className="px-4 py-6 rounded-xl border-2 border-dashed border-default text-sm text-dim text-center">
        No APK has been built yet. Run{" "}
        <code className="font-mono text-xs">./mobile/build_apk.sh --lan</code>.
      </div>
    );
  }

  const apk = info.apk;
  const loopback = url !== null && isLoopback(url);

  return (
    <div className="rounded-xl border border-default bg-surface-raised p-4 flex flex-col sm:flex-row gap-4 items-center sm:items-start">
      <div
        className="w-44 h-44 shrink-0 rounded-lg bg-white p-1 [&>svg]:w-full [&>svg]:h-full"
        role="img"
        aria-label={url ? `QR code for ${url}` : "QR code"}
        // The library's own SVG output, built from our URL; no user input.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className="min-w-0 space-y-2 text-sm">
        <p>
          Scan with the phone&apos;s camera to download Namu
          {apk.variant === "lan" ? " (LAN test build)" : ""}, build{" "}
          {apk.version_code}.
        </p>
        <p className="text-xs text-muted">
          {megabytes(apk.size)} · built{" "}
          {new Date(apk.built_at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . The first time, Android asks you to allow installing apps from the
          browser.
        </p>
        {url && (
          <a
            href={url}
            className="block font-mono text-xs text-muted hover:text-secondary break-all"
          >
            {url}
          </a>
        )}
        {loopback && (
          <p className="text-xs rounded-lg px-3 py-2 bg-tint-amber-a text-tint-amber-ink border border-tint-amber-line">
            This address points at the phone itself, so the download won&apos;t
            work from there. Set <code className="font-mono">NAMU_DOWNLOAD_BASE_URL</code>{" "}
            in <code className="font-mono">.env</code> to this computer&apos;s
            network address (e.g. <code className="font-mono">http://192.168.1.20:5000</code>)
            and restart, or open this page at that address.
          </p>
        )}
      </div>
    </div>
  );
}
