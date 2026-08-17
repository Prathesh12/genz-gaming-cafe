import { getSettings } from "@/server/services/settings";

/**
 * The cafe logo, served from the settings row.
 *
 * Deliberately public and unauthenticated: it appears on the sign-in screen,
 * before anyone has signed in. It is a logo, not customer data.
 *
 * The response is cached hard but keyed by a `v` token that changes whenever
 * the logo does, so a newly uploaded logo appears at once while an unchanged
 * one is never fetched twice.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const settings = await getSettings();

  if (!settings.logoData || !settings.logoMime) {
    // Nothing uploaded — the interface falls back to its built-in badge.
    return new Response(null, { status: 404 });
  }

  const bytes = Buffer.from(settings.logoData, "base64");
  const version = String(settings.logoUpdatedAt?.getTime() ?? 0);
  const etag = `"logo-${version}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const versioned = new URL(request.url).searchParams.has("v");

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": settings.logoMime,
      "Content-Length": String(bytes.byteLength),
      ETag: etag,
      // A versioned URL can be cached forever; an unversioned one is
      // revalidated so it can never get stuck showing a replaced logo.
      "Cache-Control": versioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
    },
  });
}
