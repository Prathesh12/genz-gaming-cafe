import { describe, expect, it } from "vitest";

import {
  ALLOWED_LOGO_TYPES,
  LOGO_MAX_BYTES,
  checkLogoFile,
  formatBytes,
  parseLogoDataUrl,
  scaleToFit,
} from "@/lib/logo";

/** A data URL of `bytes` bytes, for size-limit checks. */
function dataUrl(mime: string, bytes: number): string {
  const base64 = Buffer.alloc(bytes, 1).toString("base64");
  return `data:${mime};base64,${base64}`;
}

describe("choosing a logo file", () => {
  it("accepts the formats a browser can redraw", () => {
    for (const type of ALLOWED_LOGO_TYPES) {
      expect(checkLogoFile({ type, size: 200_000 }).ok).toBe(true);
    }
  });

  it("refuses SVG", () => {
    // An SVG is a document, not just pixels: served from our own origin it
    // could run scripts against the signed-in session.
    const result = checkLogoFile({ type: "image/svg+xml", size: 2_000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("PNG, JPG or WEBP");
  });

  it("refuses things that are not images at all", () => {
    expect(checkLogoFile({ type: "application/pdf", size: 1_000 }).ok).toBe(false);
    expect(checkLogoFile({ type: "text/html", size: 100 }).ok).toBe(false);
    expect(checkLogoFile({ type: "", size: 100 }).ok).toBe(false);
  });

  it("refuses an enormous file before any work is done on it", () => {
    const result = checkLogoFile({ type: "image/png", size: 25 * 1024 * 1024 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("under 10 MB");
  });
});

describe("the data URL the server stores", () => {
  it("pulls out the type and the bytes", () => {
    const result = parseLogoDataUrl(dataUrl("image/png", 300));
    expect(result.ok).toBe(true);
    expect(result.ok && result.mime).toBe("image/png");
    // Base64 padding must not be counted as image data.
    expect(result.ok && result.bytes).toBe(300);
    expect(result.data).toBeDefined();
  });

  it("refuses anything that is not a base64 image data URL", () => {
    for (const value of [
      "",
      "not a url",
      "https://example.com/logo.png",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png,notbase64",
    ]) {
      expect(parseLogoDataUrl(value).ok, value).toBe(false);
    }
  });

  it("refuses an empty image", () => {
    expect(parseLogoDataUrl("data:image/png;base64,").ok).toBe(false);
  });

  it("holds the line on size, whatever the browser sent", () => {
    expect(parseLogoDataUrl(dataUrl("image/png", LOGO_MAX_BYTES - 100)).ok).toBe(true);
    const tooBig = parseLogoDataUrl(dataUrl("image/png", LOGO_MAX_BYTES + 5_000));
    expect(tooBig.ok).toBe(false);
    expect(tooBig.ok === false && tooBig.reason).toContain("under");
  });

  it("ignores surrounding whitespace", () => {
    expect(parseLogoDataUrl(`  ${dataUrl("image/webp", 120)}\n`).ok).toBe(true);
  });
});

describe("resizing", () => {
  it("shrinks the longest edge and keeps the shape", () => {
    expect(scaleToFit(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
    expect(scaleToFit(1000, 2000, 512)).toEqual({ width: 256, height: 512 });
    expect(scaleToFit(1024, 1024, 512)).toEqual({ width: 512, height: 512 });
  });

  it("leaves a small image alone rather than blowing it up", () => {
    expect(scaleToFit(120, 80, 512)).toEqual({ width: 120, height: 80 });
  });

  it("never rounds an edge away to nothing", () => {
    const result = scaleToFit(5000, 3, 512);
    expect(result.width).toBe(512);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("copes with a zero-sized image", () => {
    expect(scaleToFit(0, 0, 512)).toEqual({ width: 0, height: 0 });
  });
});

describe("sizes people can read", () => {
  it("formats bytes, kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
