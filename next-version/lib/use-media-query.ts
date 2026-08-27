"use client";

import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function usePrefersDark(): boolean {
  return useMediaQuery("(prefers-color-scheme: dark)");
}

/**
 * Subscribe to the explicit theme choice on <html>, or null when there is
 * none and the OS decides.
 *
 * A MutationObserver rather than a React state tree because the attribute is
 * set imperatively — by the pre-paint script in the layout and by applyTheme()
 * from the settings page — and both are outside React's knowledge.
 */
function useExplicitTheme(): "light" | "dark" | null {
  return useSyncExternalStore(
    (callback) => {
      const observer = new MutationObserver(callback);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      return () => observer.disconnect();
    },
    () => {
      const value = document.documentElement.dataset.theme;
      return value === "light" || value === "dark" ? value : null;
    },
    () => null,
  );
}

/**
 * Is the page rendering dark right now?
 *
 * This is the JavaScript counterpart of the `dark` variant in globals.css, and
 * it resolves the same three states in the same order: an explicit choice
 * wins, otherwise the OS decides. The charts read it to pick a palette, which
 * is why they used to disagree with the chrome — they asked the OS directly
 * and never saw the user's preference at all.
 */
export function useIsDark(): boolean {
  const prefersDark = usePrefersDark();
  const explicit = useExplicitTheme();
  return explicit ? explicit === "dark" : prefersDark;
}
