/**
 * Single source of truth for money formatting.
 *
 * Namu's finance data originates from Brazilian Itaú card statements
 * (`flask-server/itau_pdf.py`), so stored amounts are BRL. Re-denominating the
 * whole app is a matter of changing the two constants below — every price in
 * the UI is formatted through `formatPrice`.
 */
export const CURRENCY_CODE = "BRL";
export const CURRENCY_LOCALE = "pt-BR";

// Built once: constructing an Intl.NumberFormat per call is the expensive part,
// and these tables render a formatted price on every row.
const priceFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: "currency",
  currency: CURRENCY_CODE,
});

export function formatPrice(price: number): string {
  return priceFormatter.format(price);
}
