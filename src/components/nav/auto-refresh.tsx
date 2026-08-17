"use client";

import { usePolling } from "@/hooks/use-live";

/**
 * Drop into any server-rendered page to keep it live. Rendering nothing keeps
 * the page a server component apart from this one tiny client island.
 */
export function AutoRefresh({ intervalMs = 20_000 }: { intervalMs?: number }) {
  usePolling(intervalMs);
  return null;
}
