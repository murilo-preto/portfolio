"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CURRENCY_CODE, formatPriceIn } from "@/lib/currency";

/**
 * The active display currency, as a subscribable store.
 *
 * `formatPrice` used to resolve the build-time CURRENCY_CODE, so the account
 * preference was stored, previewed on the settings page, and then ignored by
 * every screen that actually shows money. This is the missing wire.
 *
 * A module-level store rather than React context, for the same reason the
 * theme uses one: the value is written from a plain function (`applyCurrency`,
 * called by the settings page) and read from components several trees away,
 * and threading a provider through both layouts buys nothing over this.
 *
 * The server row remains the source of truth. localStorage is a mirror so the
 * first paint after a reload shows the right symbol instead of flipping once
 * the preferences request lands; a stale mirror costs one corrected render.
 */
export const CURRENCY_STORAGE_KEY = "currencyPreference";

const listeners = new Set<() => void>();

// Cached because getSnapshot runs on every render and must not touch storage
// that often. Seeded on first read rather than at module load, which would run
// during SSR where localStorage does not exist.
let cached: string | null = null;

function readStored(): string {
  try {
    return localStorage.getItem(CURRENCY_STORAGE_KEY) || CURRENCY_CODE;
  } catch {
    // Unreadable storage is indistinguishable from "never set one".
    return CURRENCY_CODE;
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): string {
  if (cached === null) cached = readStored();
  return cached;
}

/** SSR and the hydration pass both render the build-time default, so the
 *  markup the server produced and the markup React first checks agree. */
function getServerSnapshot(): string {
  return CURRENCY_CODE;
}

/** Set the active currency and tell every screen showing money. */
export function applyCurrency(code: string) {
  if (cached === code) return;
  cached = code;
  try {
    localStorage.setItem(CURRENCY_STORAGE_KEY, code);
  } catch {
    // Storage is only a mirror; the in-memory value still drives this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Format money in the user's chosen currency.
 *
 * Returns a stable callback so it can be handed to Recharts formatters and
 * memoized children without forcing a re-render on every parent update.
 */
export function useCurrency(): {
  code: string;
  formatPrice: (price: number) => string;
} {
  const code = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const formatPrice = useCallback(
    (price: number) => formatPriceIn(price, code),
    [code],
  );
  return { code, formatPrice };
}
