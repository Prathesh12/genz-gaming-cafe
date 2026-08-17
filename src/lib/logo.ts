/**
 * Rules for the cafe logo. Pure and dependency-free so they can be tested
 * directly, and so the browser and the server can apply exactly the same
 * checks — the browser for a helpful message, the server because a browser
 * check is only ever a courtesy.
 */

/**
 * Only formats a browser can decode into a canvas, and that carry no scripting.
 *
 * SVG is deliberately excluded: it is a document, not just pixels, and serving
 * a user-supplied one from our own origin would let it run scripts against the
 * signed-in session. Anything accepted here is re-drawn to PNG before storage,
 * which also strips metadata.
 */
export const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The longest edge the stored logo is scaled down to. */
export const LOGO_MAX_EDGE = 512;

/** Refuse anything larger than this once encoded. Comfortably fits a 512px PNG. */
export const LOGO_MAX_BYTES = 1_000_000;

export type LogoCheck = { ok: true; mime: string; bytes: number } | { ok: false; reason: string };

/** Human-readable size, for messages the cafe owner will actually read. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check the file the owner picked, before any work is done on it. */
export function checkLogoFile(file: { type: string; size: number }): LogoCheck {
  if (!ALLOWED_LOGO_TYPES.includes(file.type as (typeof ALLOWED_LOGO_TYPES)[number])) {
    return {
      ok: false,
      reason: "Choose a PNG, JPG or WEBP image.",
    };
  }
  // Generous: this is the file on disk, which is shrunk before it is stored.
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, reason: `That image is ${formatBytes(file.size)}. Please pick one under 10 MB.` };
  }
  return { ok: true, mime: file.type, bytes: file.size };
}

/**
 * Pull the parts out of a `data:` URL, checking the type and size as it goes.
 * This is the server-side gate: nothing is stored unless it passes here.
 */
export function parseLogoDataUrl(value: string): LogoCheck & { data?: string } {
  const match = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value.trim());
  if (!match) return { ok: false, reason: "That does not look like an image file." };

  const [, mime, data] = match;
  if (!ALLOWED_LOGO_TYPES.includes(mime as (typeof ALLOWED_LOGO_TYPES)[number])) {
    return { ok: false, reason: "Choose a PNG, JPG or WEBP image." };
  }

  // Base64 encodes three bytes as four characters, minus any padding.
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((data.length * 3) / 4) - padding;

  if (bytes <= 0) return { ok: false, reason: "That image file appears to be empty." };
  if (bytes > LOGO_MAX_BYTES) {
    return { ok: false, reason: `The logo must be under ${formatBytes(LOGO_MAX_BYTES)}. Try a smaller image.` };
  }

  return { ok: true, mime, bytes, data };
}

/** Fit a picture inside a square without stretching it. */
export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number = LOGO_MAX_EDGE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
