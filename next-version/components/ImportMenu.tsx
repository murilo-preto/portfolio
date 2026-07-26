"use client";

import { useEffect, useRef, useState } from "react";

type ImportMenuProps = {
  onSelectCsv: () => void;
  onSelectItauPdf: () => void;
  /** Styling for the trigger, so each page can match its own header buttons. */
  buttonClassName: string;
};

/** Grace period before a hover-out closes the menu, so the pointer can take a
 *  diagonal path from the trigger to an item without the menu vanishing. */
const CLOSE_DELAY_MS = 400;

/**
 * "Import" trigger that reveals the available import sources on hover.
 *
 * Hover alone would leave the menu unreachable by keyboard and on touch
 * devices, so the trigger also toggles on click and the menu opens on focus.
 */
export function ImportMenu({
  onSelectCsv,
  onSelectItauPdf,
  buttonClassName,
}: ImportMenuProps) {
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

  function choose(action: () => void) {
    close();
    action();
  }

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
        className={buttonClassName}
      >
        Import
      </button>

      {isOpen && (
        // The padding sits on this wrapper rather than as a margin on the panel
        // so the offset below the trigger is still part of the menu's hover
        // area — a margin would leave a dead strip that closes the menu.
        <div
          className="absolute right-0 top-full z-30 w-64 pt-1"
          onMouseEnter={open}
        >
          <div
            role="menu"
            className="rounded-lg border border-default bg-surface shadow-xl overflow-hidden"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onSelectCsv)}
              className="block w-full px-4 py-2.5 text-left text-sm text-secondary hover:bg-surface-hover transition-colors"
            >
              CSV
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onSelectItauPdf)}
              className="block w-full px-4 py-2.5 text-left text-sm text-secondary hover:bg-surface-hover transition-colors"
            >
              Itaú PDF Bank Statement
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
