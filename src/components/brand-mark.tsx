"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The cafe logo.
 *
 * Upload it from Settings → Cafe logo and it appears here, on the sign-in
 * screen and on printed receipts. Until then this falls back to the "GZ"
 * badge, so the app never shows a broken image.
 *
 * `public/logo.png` is still honoured for anyone who put a file there before
 * the Settings upload existed.
 */
const UPLOADED_LOGO = "/api/logo";
const FILE_LOGO = "/logo.png";

/**
 * Find a logo to draw, preferring the uploaded one.
 *
 * The image is probed before it is rendered rather than rendered and allowed
 * to fail: a missing file errors before React can attach an error handler, so
 * the browser's broken-image icon would stay on screen.
 */
function useLogoSrc(version?: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const uploaded = version ? `${UPLOADED_LOGO}?v=${version}` : UPLOADED_LOGO;

    function probe(candidate: string, onFail: () => void) {
      const image = new Image();
      image.onload = () => {
        if (!cancelled) setSrc(candidate);
      };
      image.onerror = () => {
        if (!cancelled) onFail();
      };
      image.src = candidate;
    }

    probe(uploaded, () => probe(FILE_LOGO, () => setSrc(null)));

    return () => {
      cancelled = true;
    };
  }, [version]);

  return src;
}

export function BrandMark({
  size = 32,
  className,
  rounded = true,
  version,
}: {
  size?: number;
  className?: string;
  rounded?: boolean;
  /** Changes when the logo does, so a replacement is never cached over. */
  version?: string | null;
}) {
  const src = useLogoSrc(version);

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- optional and user-uploaded; next/image cannot handle it being absent
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 object-contain", rounded && "rounded-lg", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-gold/40 bg-gold/10 font-black text-gold",
        rounded && "rounded-lg",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      GZ
    </span>
  );
}

/** Larger lock-up for the sign-in screen: logo above the cafe name. */
export function BrandLockup({ cafeName, version }: { cafeName: string; version?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <BrandMark
        size={96}
        rounded={false}
        version={version}
        className="drop-shadow-[0_0_24px_rgba(245,197,24,0.25)]"
      />
      <div className="text-center">
        <h1 className="text-2xl font-black tracking-tight text-ink">{cafeName}</h1>
        <p className="mt-1 text-sm text-ink-muted">Staff console</p>
      </div>
    </div>
  );
}
