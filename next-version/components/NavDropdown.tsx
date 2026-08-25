"use client";

import { PrefetchLink } from "@/components/PrefetchLink";
import { useEffect, useRef, useState } from "react";

export type NavDropdownItem = { label: string; href: string };

type NavDropdownProps = {
  label: string;
  items: NavDropdownItem[];
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
export function NavDropdown({ label, items }: NavDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        className="bg-surface-deep p-1 rounded-md flex items-center gap-1 hover:cursor-pointer"
      >
        {label}
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        // The padding sits on this wrapper rather than as a margin on the panel
        // so the offset below the trigger is still part of the menu's hover
        // area — a margin would leave a dead strip that closes the menu.
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full z-30 min-w-max pt-1"
          onMouseEnter={open}
        >
          <div
            role="menu"
            className="rounded-lg border border-default bg-surface shadow-xl overflow-hidden"
          >
            {items.map((item) => (
              <PrefetchLink
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={close}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-secondary hover:bg-surface-hover transition-colors"
              >
                {item.label}
              </PrefetchLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
