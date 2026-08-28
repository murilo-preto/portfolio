"use client";

import { PrefetchLink } from "@/components/PrefetchLink";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";

export type NavVariant = "default" | "mobile";

/** The nav href the current page corresponds to, or null before hydration.
 *  Matching is exact everywhere: `/namu/user` is a page in its own right and
 *  must not stay lit for every route nested beneath it. */
export function useActiveHref(): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  // A trailing slash only ever arrives from a hand-typed URL, but it would
  // silently defeat the comparisons below.
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * The one place a nav item's look is defined — links here and the dropdown
 * triggers in `NavDropdown` both call it, so a group header and a plain link
 * read as the same kind of thing.
 *
 * The current page is marked by a hairline under the label rather than by
 * inverting the whole item. `bg-invert` is warm near-black in light and
 * near-white in dark, so the underline needs no `dark:` twin. On mobile the
 * rows are full width, where an underline spanning the whole row reads as a
 * divider — those get a filled background instead.
 */
export function navItemClass(
  active: boolean,
  variant: NavVariant = "default",
): string {
  const base =
    "relative rounded-md text-sm font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400";

  const shape =
    variant === "mobile"
      ? "block w-full text-left px-3 py-2.5"
      : "inline-flex items-center gap-1 px-3 py-2";

  const state = active
    ? variant === "mobile"
      ? "bg-surface-hover text-primary font-semibold"
      : "text-primary font-semibold after:absolute after:inset-x-3 " +
        "after:bottom-1 after:h-0.5 after:rounded-full after:bg-invert"
    : "text-secondary hover:text-primary hover:bg-surface-hover";

  return `${base} ${shape} ${state}`;
}

/**
 * A nav item. The classes sit on the link itself rather than on a wrapper, so
 * the padding around the label is part of the hit target.
 */
export function NavLink({
  href,
  children,
  active = false,
  variant = "default",
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  /** Marks the page currently on screen. */
  active?: boolean;
  variant?: NavVariant;
  onClick?: () => void;
}) {
  return (
    <PrefetchLink
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={navItemClass(active, variant)}
    >
      {children}
    </PrefetchLink>
  );
}

/** Hamburger for the sub-`md` bar. */
export function MenuToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  const Icon = open ? X : Menu;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Toggle menu"
      aria-expanded={open}
      className="md:hidden -mr-1 p-2 rounded-lg text-secondary hover:text-primary
        hover:bg-surface-hover transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
    >
      <Icon className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}
