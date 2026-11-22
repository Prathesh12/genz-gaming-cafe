/**
 * All money in this application is stored and computed in **minor units**
 * (piastres for EGP). Only convert at the UI/input boundary.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

/** 120.50 EGP (as typed by a human) -> 12050 */
export function toMinor(majorUnits: number): number {
  return Math.round(majorUnits * MINOR_UNITS_PER_MAJOR);
}

/** 12050 -> 120.5 */
export function toMajor(minorUnits: number): number {
  return minorUnits / MINOR_UNITS_PER_MAJOR;
}

/** Format a minor-unit amount consistently as, for example, "150.00 EGP". */
export function formatMoney(minorUnits: number, currencyCode = "EGP"): string {
  const negative = minorUnits < 0;
  const abs = Math.abs(minorUnits);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = new Intl.NumberFormat("en-EG").format(major);
  const body = `${grouped}.${String(minor).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${body} ${currencyCode}`;
}

/** Same as formatMoney but without the currency code — for CSV exports. */
export function formatMoneyPlain(minorUnits: number): string {
  return (minorUnits / MINOR_UNITS_PER_MAJOR).toFixed(2);
}

/** Percentage of an amount, rounded to the nearest minor unit (half up). */
export function percentOf(minorUnits: number, percent: number): number {
  return Math.round((minorUnits * percent) / 100);
}
