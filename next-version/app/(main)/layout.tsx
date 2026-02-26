"use client";

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import { useState } from "react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function NavLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
      <Link href={href} onClick={onClick}>
        {children}
      </Link>
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <header className="m-1 p-1 rounded-md bg-gray-100 dark:bg-neutral-900">
      {/* ── Desktop nav (md+) ── */}
      <nav className="hidden md:grid grid-cols-3 items-center p-1">
        {/* Left */}
        <div className="justify-self-start">
          <NavLink href="/">Home</NavLink>
        </div>

        {/* Center */}
        <div className="justify-self-center flex gap-2">
          <NavLink href="/cv">CV</NavLink>
          <NavLink href="/namu">Namu</NavLink>
          <NavLink href="/demo">Demo</NavLink>
        </div>

        {/* Right */}
        <div className="justify-self-end flex gap-2">
          <NavLink href="/login">Login</NavLink>
          <NavLink href="/register">Register</NavLink>
          <LogoutButton />
        </div>
      </nav>

      {/* ── Mobile nav (< md) ── */}
      <div className="md:hidden flex items-center justify-between p-1">
        {/* Logo / Home */}
        <NavLink href="/">Home</NavLink>

        {/* Hamburger button */}
        <button
          onClick={() => setMenuOpen((prev) => !prev)}
          className="bg-gray-50 dark:bg-neutral-950 p-2 rounded-md focus:outline-none"
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            // X icon
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
            // Hamburger icon
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

      {/* ── Mobile dropdown ── */}
      {menuOpen && (
        <div className="md:hidden flex flex-col gap-2 p-2 mt-1 border-t border-gray-200 dark:border-neutral-700">
          {/* Pages */}
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 px-1">
            Pages
          </p>
          <NavLink href="/cv" onClick={close}>
            CV
          </NavLink>
          <NavLink href="/namu" onClick={close}>
            Namu
          </NavLink>
          <NavLink href="/demo" onClick={close}>
            Demo
          </NavLink>

          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 px-1 mt-2">
            Account
          </p>
          <NavLink href="/login" onClick={close}>
            Login
          </NavLink>
          <NavLink href="/register" onClick={close}>
            Register
          </NavLink>
          <div onClick={close}>
            <LogoutButton />
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="m-1 p-1 rounded-md bg-gray-100 dark:bg-neutral-900">
      Footer
    </footer>
  );
}

export default function RootLayout({
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
        {/* <Footer /> */}
      </body>
    </html>
  );
}
