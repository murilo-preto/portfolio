"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });

    router.push("/login");
    router.refresh(); // refresh server state
  }

  return (
    <button
      onClick={handleLogout}
      className="bg-surface-deep p-1 rounded-md hover:cursor-pointer"
    >
      Logout
    </button>
  );
}
