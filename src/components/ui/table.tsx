import * as React from "react";

import { cn } from "@/lib/utils";

/** Horizontally scrollable wrapper so wide tables stay usable on a phone. */
export function TableWrap({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("scrollbar-slim w-full overflow-x-auto rounded-xl border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full min-w-max border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-2", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-surface-2", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle whitespace-nowrap", className)} {...props} />;
}
