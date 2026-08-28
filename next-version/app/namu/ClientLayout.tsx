"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { PrefetchLink } from "@/components/PrefetchLink";
import { ThemeScript } from "@/components/ThemeScript";
import LogoutButton from "@/components/LogoutButton";
import {
  MenuToggle,
  NavLink,
  navItemClass,
  useActiveHref,
} from "@/components/NavLink";
import { NavDropdown, type NavDropdownItem } from "@/components/NavDropdown";
import { Settings } from "lucide-react";
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

const SETTINGS_HREF = "/namu/user/settings";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-muted px-3 pt-3 pb-1">
      {children}
    </p>
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

  // Escape closes the panel; a link tap already closes it via `onClick`.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    // `z-40` keeps the open dropdowns above page content that creates its own
    // stacking context (the entries and finance toolbars do).
    <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-subtle">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Desktop nav (md+) ── */}
        <nav className="hidden md:grid grid-cols-3 items-center h-14">
          {/* Left */}
          <div className="justify-self-start -ml-3">
            <NavLink href="/">Home</NavLink>
          </div>

          {/* Center */}
          <div className="justify-self-center flex items-center gap-1">
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
          <div className="justify-self-end flex items-center gap-1 -mr-3">
            {isLoggedIn ? (
              <>
                <PrefetchLink
                  href={SETTINGS_HREF}
                  aria-label="Settings"
                  title="Settings"
                  aria-current={activeHref === SETTINGS_HREF ? "page" : undefined}
                  className={navItemClass(activeHref === SETTINGS_HREF)}
                >
                  <Settings className="w-5 h-5" aria-hidden="true" />
                </PrefetchLink>
                <LogoutButton variant="icon" />
              </>
            ) : (
              <NavLink href="/login">Login</NavLink>
            )}
          </div>
        </nav>

        {/* ── Mobile nav (< md) ── */}
        <div className="md:hidden flex items-center justify-between h-14">
          <div className="-ml-3">
            <NavLink href="/">Home</NavLink>
          </div>
          <MenuToggle
            open={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          />
        </div>

        {/* ── Mobile dropdown ── */}
        {menuOpen && (
          // Groups become labelled sections rather than hover menus — an
          // accordion reads better on a narrow screen and needs no pointer.
          <div className="md:hidden flex flex-col gap-1 pb-3 -mx-1 border-t border-default animate-rise">
            {NAV_ENTRIES.map((entry) =>
              isGroup(entry) ? (
                <div key={entry.label} className="flex flex-col gap-1">
                  <SectionLabel>{entry.label}</SectionLabel>
                  {entry.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      variant="mobile"
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
                  variant="mobile"
                  active={entry.href === activeHref}
                  onClick={close}
                >
                  {entry.label}
                </NavLink>
              ),
            )}

            <SectionLabel>Account</SectionLabel>
            {isLoggedIn ? (
              <>
                <NavLink
                  href={SETTINGS_HREF}
                  variant="mobile"
                  active={activeHref === SETTINGS_HREF}
                  onClick={close}
                >
                  Settings
                </NavLink>
                <div onClick={close}>
                  <LogoutButton variant="mobile" />
                </div>
              </>
            ) : (
              <NavLink href="/login" variant="mobile" onClick={close}>
                Login
              </NavLink>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col
          bg-background text-foreground`}
      >
        <Header />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
