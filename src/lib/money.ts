/**
 * All money in this application is stored and computed in **minor units**
 * (paise). Only convert at the UI/input boundary.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

/** ₹120.50 (as typed by a human) -> 12050 */
export function toMinor(rupees: number): number {
  return Math.round(rupees * MINOR_UNITS_PER_MAJOR);
}

/** 12050 -> 120.5 */
export function toMajor(paise: number): number {
  return paise / MINOR_UNITS_PER_MAJOR;
}

/**
 * Format for display. Whole rupees drop the decimals (₹300 rather than
 * ₹300.00) which is how Indian cafe bills are normally written.
 */
export function formatMoney(paise: number, symbol = "₹"): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = new Intl.NumberFormat("en-IN").format(major);
  const body = minor === 0 ? grouped : `${grouped}.${String(minor).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${symbol}${body}`;
}

/** Same as formatMoney but without the currency symbol — for CSV exports. */
export function formatMoneyPlain(paise: number): string {
  return (paise / MINOR_UNITS_PER_MAJOR).toFixed(2);
}

/** Percentage of an amount, rounded to the nearest paisa (half up). */
export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}
