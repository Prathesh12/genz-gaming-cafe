import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide uppercase",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-surface-3 text-ink-muted",
        gold: "border-gold/40 bg-gold/10 text-gold",
        ok: "border-ok/40 bg-ok/10 text-ok",
        info: "border-info/40 bg-info/10 text-info",
        warn: "border-warn/40 bg-warn/10 text-warn",
        danger: "border-danger/40 bg-danger/10 text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/**
 * Status is communicated by a shape + text, never by colour alone, so the
 * board stays readable for colour-blind staff and in bright sunlight.
 */
const STATION_STATUS: Record<string, { label: string; tone: BadgeProps["tone"]; glyph: string }> = {
  AVAILABLE: { label: "Available", tone: "ok", glyph: "●" },
  OCCUPIED: { label: "Occupied", tone: "gold", glyph: "▶" },
  RESERVED: { label: "Reserved", tone: "info", glyph: "◆" },
  MAINTENANCE: { label: "Maintenance", tone: "warn", glyph: "▲" },
};

export function StationStatusBadge({ status, className }: { status: string; className?: string }) {
  const config = STATION_STATUS[status] ?? { label: status, tone: "neutral" as const, glyph: "●" };
  return (
    <Badge tone={config.tone} className={className}>
      <span aria-hidden>{config.glyph}</span>
      {config.label}
    </Badge>
  );
}

const SESSION_STATUS: Record<string, { label: string; tone: BadgeProps["tone"] }> = {
  ACTIVE: { label: "Active", tone: "gold" },
  PAUSED: { label: "Paused", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export function SessionStatusBadge({ status }: { status: string }) {
  const config = SESSION_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

const PAYMENT_TONE: Record<string, BadgeProps["tone"]> = {
  CASH: "ok",
  UPI: "info",
  SPLIT: "gold",
};

export function PaymentBadge({ method }: { method: string }) {
  return <Badge tone={PAYMENT_TONE[method] ?? "neutral"}>{method}</Badge>;
}

const FOOD_STATUS: Record<string, BadgeProps["tone"]> = {
  ORDERED: "neutral",
  PREPARING: "warn",
  READY: "info",
  SERVED: "ok",
  CANCELLED: "danger",
};

export function FoodStatusBadge({ status }: { status: string }) {
  return <Badge tone={FOOD_STATUS[status] ?? "neutral"}>{status.toLowerCase()}</Badge>;
}
