"use client";

import { useState } from "react";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
] as const;

/**
 * Date range control shared by Income, Reports and Transactions. The selection
 * lives in the URL so a range can be bookmarked, shared, or reloaded.
 */
export function RangePicker({ preset, from, to }: { preset: string; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");

  function apply(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <button
            key={item.value}
            onClick={() => apply({ preset: item.value, from: undefined, to: undefined })}
            aria-pressed={preset === item.value}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              preset === item.value
                ? "border-gold bg-gold/15 text-gold"
                : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Input
          type="date"
          value={customFrom}
          onChange={(event) => setCustomFrom(event.target.value)}
          className="w-40"
          aria-label="From date"
        />
        <span className="pb-3 text-ink-faint">→</span>
        <Input
          type="date"
          value={customTo}
          onChange={(event) => setCustomTo(event.target.value)}
          className="w-40"
          aria-label="To date"
        />
        <Button
          variant="secondary"
          disabled={!customFrom || !customTo}
          onClick={() => apply({ preset: "custom", from: customFrom, to: customTo })}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
