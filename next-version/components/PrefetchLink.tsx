"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { prefetchRouteData } from "@/lib/prefetch";

type PrefetchLinkProps = ComponentProps<typeof Link>;

/**
 * `next/link` that also warms the target on hover: its route payload and the
 * `/api` data the page loads on mount (see `lib/prefetch`). Touch devices get
 * the same head start on touch-start, a moment before the tap lands.
 */
export function PrefetchLink({
  href,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...rest
}: PrefetchLinkProps) {
  const router = useRouter();

  function warm() {
    if (typeof href !== "string") return;
    router.prefetch(href);
    prefetchRouteData(href);
  }

  return (
    <Link
      href={href}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      {...rest}
    />
  );
}

export default PrefetchLink;
