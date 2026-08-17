import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption of sensitive personal data (currently Aadhaar numbers).
 *
 * - `encryptSensitive` uses AES-256-GCM. The stored value is
 *   base64(iv || authTag || ciphertext), so it is self-describing and
 *   tamper-evident.
 * - `blindIndex` is a keyed HMAC used *only* to detect duplicates and to look
 *   a value up without ever storing or querying the plaintext.
 *
 * The key comes from ENCRYPTION_KEY (64 hex characters = 32 bytes). Rotating
 * the key makes existing ciphertexts unreadable — document any rotation.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your environment.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    throw new Error("ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).");
  }
  cachedKey = Buffer.from(raw.trim(), "hex");
  return cachedKey;
}

export function encryptSensitive(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSensitive(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted payload is malformed.");
  }
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Deterministic keyed hash used for duplicate detection only. */
export function blindIndex(value: string): string {
  return createHmac("sha256", getKey()).update(value.replace(/\s+/g, "")).digest("hex");
}

/** Constant-time comparison for tokens and codes. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** "123456789012" -> "XXXX XXXX 9012". Never renders the first 8 digits. */
export function maskAadhaar(last4: string | null | undefined): string {
  if (!last4) return "—";
  return `XXXX XXXX ${last4}`;
}
