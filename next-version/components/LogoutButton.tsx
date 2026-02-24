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
      className="bg-gray-50 p-1 rounded-md dark:bg-neutral-950 hover:cursor-pointer"
    >
      Logout
    </button>
  );
}
