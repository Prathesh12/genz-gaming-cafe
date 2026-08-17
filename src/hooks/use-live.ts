"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useRouter } from "next/navigation";

/**
 * A ticking clock for live timers.
 *
 * Implemented with `useSyncExternalStore` rather than setState-in-an-effect:
 * the server snapshot is `0`, so the first paint matches the server markup and
 * the value starts ticking as soon as the component hydrates.
 */
export function useNow(intervalMs = 1000): Date | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const timer = setInterval(onChange, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );

  const tick = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs),
    () => 0,
  );

  return tick === 0 ? null : new Date(tick * intervalMs);
}

/**
 * Keep server-rendered data fresh without websockets.
 *
 * `router.refresh()` re-runs the server components and streams down only the
 * changed markup, which is cheap enough to run every few seconds for a cafe
 * with a handful of tills. Polling pauses while the tab is hidden — a tablet
 * left on the counter overnight should not hammer the database — and callers
 * pass `enabled: false` to pause it while a dialog is open.
 */
export function usePolling(intervalMs = 15_000, enabled = true) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled, router]);
}

/** Debounce any fast-changing value (used by the search boxes). */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
