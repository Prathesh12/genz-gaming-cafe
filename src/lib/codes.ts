import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — avoids misreading

/** Short, unambiguous, non-sequential suffix. */
export function shortCode(length = 5): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function yymmdd(date: Date): string {
  const year = String(date.getUTCFullYear()).slice(2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/** e.g. S-260814-K7Q2M */
export function sessionCode(now = new Date()): string {
  return `S-${yymmdd(now)}-${shortCode()}`;
}

/** e.g. F-260814-B4T9X */
export function foodOrderCode(now = new Date()): string {
  return `F-${yymmdd(now)}-${shortCode()}`;
}

/** Member codes stay human-friendly and sequential within the cafe. */
export function memberCode(sequence: number): string {
  return `GZM-${String(sequence).padStart(5, "0")}`;
}
