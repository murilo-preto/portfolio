"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function NamuHome() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/token")
      .then((res) => {
        setIsLoggedIn(res.ok);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const features = [
    {
      title: "Track Time",
      description: "Log your activities with start and end times",
      href: "/namu/user/manage",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "View Analytics",
      description: "See how you spend your time with charts and tables",
      href: "/namu/user/entries",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      title: "Live Timer",
      description: "Track your current activity in real-time",
      href: "/namu/user/timer",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: "Import CSV",
      description: "Bulk import your historical data",
      href: "/namu/user/csv",
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      ),
    },
  ];

  return (
    <main className="flex-1 px-4 py-8 md:px-8 md:py-12 max-w-4xl mx-auto">
      <section className="text-center py-12 md:py-20">
        <h1 className="text-4xl md:text-6xl font-bold mb-4 text-gray-900 dark:text-gray-100">
          Namu
        </h1>
        <p className="text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-lg mx-auto">
          A simple and powerful time tracking app to help you understand how you spend your time.
        </p>

        {!loading && !isLoggedIn && (
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              className="px-6 py-3 bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="px-6 py-3 border border-gray-300 dark:border-neutral-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
            >
              Register
            </Link>
          </div>
        )}

        {!loading && isLoggedIn && (
          <div className="mt-8">
            <Link
              href="/namu/user/entries"
              className="px-6 py-3 bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Go to Dashboard
            </Link>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
        {features.map((feature) => (
          <Link
            key={feature.href}
            href={feature.href}
            className="block p-6 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-gray-400 dark:hover:border-neutral-500 transition-colors group"
          >
            <div className="text-gray-600 dark:text-gray-400 mb-3 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors">
              {feature.icon}
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {feature.title}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {feature.description}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
