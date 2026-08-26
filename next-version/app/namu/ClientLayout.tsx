"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { PrefetchLink } from "@/components/PrefetchLink";
import LogoutButton from "@/components/LogoutButton";
import { NavDropdown, type NavDropdownItem } from "@/components/NavDropdown";
import { usePathname } from "next/navigation";
import { applyTheme, readStoredTheme } from "@/lib/preferences";
import { useState, useEffect } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

type NavGroup = { label: string; items: NavDropdownItem[] };
type NavEntry = NavDropdownItem | NavGroup;

/** Single source for the nav, shared by the desktop bar and the mobile panel.
 *  Entries with `items` become a dropdown; the rest are plain links. */
const NAV_ENTRIES: NavEntry[] = [
  { label: "Dashboard", href: "/namu/user" },
  {
    label: "Time management",
    items: [
      { label: "Entries", href: "/namu/user/entries" },
      { label: "Stopwatch", href: "/namu/user/timer" },
      { label: "Manage Entries", href: "/namu/user/manage" },
      { label: "Import CSV", href: "/namu/user/csv" },
    ],
  },
  {
    label: "Task management",
    items: [
      { label: "To Do", href: "/namu/user/todo" },
      { label: "Pomodoro", href: "/namu/user/pomodoro" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Overview", href: "/namu/user/finance" },
      { label: "Manage Expenses", href: "/namu/user/finance/manage" },
    ],
  },
  { label: "Categories", href: "/namu/user/categories" },
];

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

/** The nav href the current page corresponds to, or null before hydration.
 *  Matching is exact everywhere: `/namu/user` is a page in its own right and
 *  must not stay lit for every route nested beneath it. */
function useActiveHref(): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  // A trailing slash only ever arrives from a hand-typed URL, but it would
  // silently defeat the comparisons below.
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function NavLink({
  href,
  children,
  active = false,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  /** Marks the page currently on screen. */
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`p-1 rounded-md hover:cursor-pointer transition-colors ${
        active
          ? "bg-invert text-invert-fg font-semibold"
          : "bg-surface-deep hover:bg-surface-hover"
      }`}
    >
      <PrefetchLink
        href={href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
      >
        {children}
      </PrefetchLink>
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const activeHref = useActiveHref();
  const close = () => setMenuOpen(false);

  useEffect(() => {
    fetch("/api/token")
      .then((res) => setIsLoggedIn(res.ok))
      .catch(() => setIsLoggedIn(false));
  }, []);

  // The settings page writes the choice to localStorage; every other page
  // needs it painted on mount or a hard reload falls back to the OS setting.
  useEffect(() => {
    applyTheme(readStoredTheme());
  }, []);

  return (
    // `relative z-40` keeps the open dropdowns above page content that creates
    // its own stacking context (the entries and finance toolbars do).
    <header className="relative z-40 m-1 p-1 rounded-md bg-surface">
      {/* ── Desktop nav (md+) ── */}
      <nav className="hidden md:grid grid-cols-3 items-center p-1">
        {/* Left */}
        <div className="justify-self-start">
          <NavLink href="/">Home</NavLink>
        </div>

        {/* Center */}
        <div className="justify-self-center flex gap-2">
          {NAV_ENTRIES.map((entry) =>
            isGroup(entry) ? (
              <NavDropdown
                key={entry.label}
                label={entry.label}
                items={entry.items}
                activeHref={activeHref}
              />
            ) : (
              <NavLink
                key={entry.href}
                href={entry.href}
                active={entry.href === activeHref}
              >
                {entry.label}
              </NavLink>
            ),
          )}
        </div>

        {/* Right */}
        <div className="justify-self-end flex gap-2">
          {isLoggedIn ? (
            <>
              <NavLink
                href="/namu/user/settings"
                active={activeHref === "/namu/user/settings"}
              >
                Settings
              </NavLink>
              <LogoutButton />
            </>
          ) : (
            <>
              <NavLink href="/login">Login</NavLink>
            </>
          )}
        </div>
      </nav>

      {/* ── Mobile nav (< md) ── */}
      <div className="md:hidden flex items-center justify-between p-1">
        {/* Logo / Home */}
        <NavLink href="/">Home</NavLink>

        {/* Hamburger button */}
        <button
          onClick={() => setMenuOpen((prev) => !prev)}
          className="bg-surface-deep p-2 rounded-md focus:outline-none"
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile dropdown (account links) ── */}
      {menuOpen && (
        // Groups become labelled sections rather than hover menus — an
        // accordion reads better on a narrow screen and needs no pointer.
        <div className="md:hidden flex flex-col gap-2 p-2 mt-1 border-t border-default">
          {NAV_ENTRIES.map((entry) =>
            isGroup(entry) ? (
              <div key={entry.label} className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted px-1">
                  {entry.label}
                </p>
                {entry.items.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    active={item.href === activeHref}
                    onClick={close}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink
                key={entry.href}
                href={entry.href}
                active={entry.href === activeHref}
                onClick={close}
              >
                {entry.label}
              </NavLink>
            ),
          )}

          <p className="text-xs font-semibold uppercase tracking-widest text-muted px-1 mt-2">
            Account
          </p>
          {isLoggedIn ? (
            <>
              <NavLink
                href="/namu/user/settings"
                active={activeHref === "/namu/user/settings"}
                onClick={close}
              >
                Settings
              </NavLink>
              <div onClick={close}>
                <LogoutButton />
              </div>
            </>
          ) : (
            <>
              <NavLink href="/login" onClick={close}>
                Login
              </NavLink>
            </>
          )}
        </div>
      )}
    </header>
  );
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col
          bg-gray-50 text-gray-900
          dark:bg-gray-900 dark:text-gray-100`}
      >
        <Header />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
