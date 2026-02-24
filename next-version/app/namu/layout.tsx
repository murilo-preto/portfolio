import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Namu",
  description: "Namu app",
};

function Header() {
  return (
    <header
      className="
        m-1 p-1 rounded-md
        bg-gray-100
        dark:bg-neutral-900
      "
    >
      <nav
        className="
          grid grid-cols-3 items-center
          p-1
        "
      >
        {/* Left */}
        <div className="justify-self-start">
          <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
            <Link href="/namu">Home</Link>
          </div>
        </div>

        {/* Center - subpáginas do Namu */}
        <div className="justify-self-center flex gap-2">
          <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
            <Link href="/namu/user/entries">Entries</Link>
          </div>
          <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
            <Link href="/namu/user/timer">Timer</Link>
          </div>
        </div>

        {/* Right */}
        <div className="justify-self-end flex gap-2">
          <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
            <Link href="/login">Login</Link>
          </div>
          <div className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer">
            <Link href="/register">Register</Link>
          </div>
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer
      className="
        m-1 p-1 rounded-md
        bg-gray-100
        dark:bg-neutral-900
      "
    >
      Footer
    </footer>
  );
}

export default function NamuLayout({
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
