"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { ThemeScript } from "@/components/ThemeScript";
import LogoutButton from "@/components/LogoutButton";
import { MenuToggle, NavLink, useActiveHref } from "@/components/NavLink";
import { useState, useEffect } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const PAGES = [
  { label: "CV", href: "/cv" },
  { label: "Namu", href: "/namu" },
  { label: "Demo", href: "/demo" },
];

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
    <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-subtle">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* ── Desktop nav (md+) ── */}
        <nav className="hidden md:grid grid-cols-3 items-center h-14">
          {/* Left */}
          <div className="justify-self-start -ml-3">
            <NavLink href="/" active={activeHref === "/"}>
              Home
            </NavLink>
          </div>

          {/* Center */}
          <div className="justify-self-center flex items-center gap-1">
            {PAGES.map((page) => (
              <NavLink
                key={page.href}
                href={page.href}
                active={page.href === activeHref}
              >
                {page.label}
              </NavLink>
            ))}
          </div>

          {/* Right */}
          <div className="justify-self-end -mr-3">
            {isLoggedIn ? (
              <LogoutButton variant="icon" />
            ) : (
              <NavLink href="/login">Login</NavLink>
            )}
          </div>
        </nav>

        {/* ── Mobile nav (< md) ── */}
        <div className="md:hidden flex items-center justify-between h-14">
          <div className="-ml-3">
            <NavLink href="/" active={activeHref === "/"}>
              Home
            </NavLink>
          </div>
          <MenuToggle
            open={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          />
        </div>

        {/* ── Mobile dropdown ── */}
        {menuOpen && (
          <div className="md:hidden flex flex-col gap-1 pb-3 -mx-1 border-t border-default animate-rise">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted px-3 pt-3 pb-1">
              Pages
            </p>
            {PAGES.map((page) => (
              <NavLink
                key={page.href}
                href={page.href}
                variant="mobile"
                active={page.href === activeHref}
                onClick={close}
              >
                {page.label}
              </NavLink>
            ))}

            <p className="text-xs font-semibold uppercase tracking-widest text-muted px-3 pt-3 pb-1">
              Account
            </p>
            {isLoggedIn ? (
              <div onClick={close}>
                <LogoutButton variant="mobile" />
              </div>
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
