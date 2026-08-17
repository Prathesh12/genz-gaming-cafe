import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A single headline number. `accent` makes the value gold — reserved for the
 * numbers that matter most on a screen so gold keeps its meaning.
 */
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface px-4 py-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
      </div>
      <p
        className={cn(
          "tabular mt-1.5 text-2xl leading-tight font-bold sm:text-[26px]",
          accent ? "text-gold" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-ink-faint">{sub}</p> : null}
    </div>
  );
}

export function StatGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)} {...props} />;
}
