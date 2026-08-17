import * as React from "react";

import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      <div className="rounded-full border border-line bg-surface-2 p-3 text-ink-faint">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description ? <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-ink-muted", className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-danger/40 bg-danger/5 px-6 py-10 text-center",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description ? <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-3", className)} aria-hidden />;
}
