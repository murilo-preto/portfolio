"use client";

import { PrefetchLink } from "@/components/PrefetchLink";
import { navItemClass } from "@/components/NavLink";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type NavDropdownItem = { label: string; href: string };

type NavDropdownProps = {
  label: string;
  items: NavDropdownItem[];
  /** Current route, so the group and its matching item can show as active. */
  activeHref?: string | null;
};

/** Grace period before a hover-out closes the menu, so the pointer can take a
 *  diagonal path from the trigger to an item without the menu vanishing. */
const CLOSE_DELAY_MS = 400;

/**
 * Nav group header that reveals its sub-pages on hover.
 *
 * The header itself does not navigate — only the items do. Hover alone would
 * leave the menu unreachable by keyboard and on touch devices, so the trigger
 * also toggles on click and the menu opens on focus.
 */
export function NavDropdown({
  label,
  items,
  activeHref = null,
}: NavDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The group carries the highlight while the menu is shut, which is the only
  // state in which the active item itself isn't visible.
  const containsActive = items.some((item) => item.href === activeHref);

  function cancelClose() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function open() {
    cancelClose();
    setIsOpen(true);
  }

  function close() {
    cancelClose();
    setIsOpen(false);
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setIsOpen(false), CLOSE_DELAY_MS);
  }

  useEffect(() => cancelClose, []);

  return (
    <div
      className="relative"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocus={open}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          close();
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        className={navItemClass(containsActive)}
      >
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        // The padding sits on this wrapper rather than as a margin on the panel
        // so the offset below the trigger is still part of the menu's hover
        // area — a margin would leave a dead strip that closes the menu.
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full z-30 min-w-max pt-2"
          onMouseEnter={open}
        >
          <div
            role="menu"
            className="rounded-xl border border-subtle bg-surface shadow-lg overflow-hidden p-1 animate-rise"
          >
            {items.map((item) => {
              const active = item.href === activeHref;
              return (
                <PrefetchLink
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") close();
                  }}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${
                      active
                        ? "bg-surface-hover text-primary font-semibold"
                        : "text-secondary hover:text-primary hover:bg-surface-hover"
                    }`}
                >
                  {item.label}
                </PrefetchLink>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
