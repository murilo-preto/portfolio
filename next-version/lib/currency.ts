/**
 * Money formatting primitives.
 *
 * Namu's finance data originates from Brazilian Itaú card statements
 * (`flask-server/itau_pdf.py`), so BRL is the default an account starts with.
 *
 * Screens do not format money from here. They go through `useCurrency()` in
 * `lib/use-currency.ts`, which resolves the account preference; this module
 * only knows how to render an amount in a currency it is handed. There is
 * deliberately no zero-argument `formatPrice` any more — one existed, it
 * resolved the build-time CURRENCY_CODE, and every screen that used it
 * silently ignored the user's choice.
 */
/** The currency an account has before it expresses a preference. */
export const CURRENCY_CODE = "BRL";
export const CURRENCY_LOCALE = "pt-BR";

/**
 * The codes offered as an account preference. Each maps to the locale whose
 * conventions that currency is normally written in, so an amount reads the way
 * its country writes it (`R$ 1.234,56` vs `$1,234.56`).
 */
export const SUPPORTED_CURRENCIES = {
  BRL: { locale: "pt-BR", label: "Brazilian real" },
  USD: { locale: "en-US", label: "US dollar" },
  EUR: { locale: "de-DE", label: "Euro" },
  GBP: { locale: "en-GB", label: "British pound" },
  JPY: { locale: "ja-JP", label: "Japanese yen" },
} as const;

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return code in SUPPORTED_CURRENCIES;
}

// Built once per currency: constructing an Intl.NumberFormat per call is the
// expensive part, and these tables render a formatted price on every row.
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(code: string): Intl.NumberFormat {
  const cached = formatterCache.get(code);
  if (cached) return cached;

  const locale = isSupportedCurrency(code)
    ? SUPPORTED_CURRENCIES[code].locale
    : CURRENCY_LOCALE;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: isSupportedCurrency(code) ? code : CURRENCY_CODE,
  });
  formatterCache.set(code, formatter);
  return formatter;
}

/** Format an amount in an explicit currency. */
export function formatPriceIn(price: number, code: string): string {
  return formatterFor(code).format(price);
}
