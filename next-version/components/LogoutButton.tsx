"use client";

import { navItemClass } from "@/components/NavLink";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

/** `icon` is the desktop bar, where the action sits beside the settings gear.
 *  `mobile` is the slide-down panel, where a bare icon among labelled rows
 *  would read as a mistake. */
type LogoutVariant = "icon" | "mobile" | "default";

export default function LogoutButton({
  variant = "default",
}: {
  variant?: LogoutVariant;
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });

    router.push("/login");
    router.refresh(); // refresh server state
  }

  if (variant === "icon") {
    return (
      <button
        onClick={handleLogout}
        aria-label="Log out"
        title="Log out"
        className={navItemClass(false)}
      >
        <LogOut className="w-5 h-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button onClick={handleLogout} className={navItemClass(false, variant)}>
      Logout
    </button>
  );
}
