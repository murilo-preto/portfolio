"use client";

import { useEffect } from "react";

export default function Entries() {
  async function get_entries() {
    try {
      const res = await fetch("/api/entries", {
        method: "GET",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch entries");
      }

      const data = await res.json();
      console.log(data);
    } catch (err) {
      console.log(err);
    }
  }

  useEffect(() => {
    get_entries();
  }, []);

  return (
    <main
      className="
        flex-1 p-6 space-y-12 max-w-5xl mx-auto
        bg-transparent
        text-gray-900
        dark:text-gray-100
      "
    >
      <h1>Entries</h1>
    </main>
  );
}
