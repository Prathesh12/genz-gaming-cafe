"use client";

import * as React from "react";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { size?: "sm" | "md" | "lg" | "xl" }) {
  const width = {
    sm: "sm:max-w-md",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-4xl",
  }[size];

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          // Full-height sheet on phones, centred dialog from `sm` upwards.
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl shadow-black/60 data-[state=open]:animate-fade-in",
          "sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88dvh] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          width,
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <DialogPrimitive.Title className="truncate text-base font-bold tracking-wide text-ink uppercase">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
      <DialogPrimitive.Close
        className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
        aria-label="Close"
      >
        <X className="size-5" />
      </DialogPrimitive.Close>
    </div>
  );
}

/**
 * Use INSTEAD of a bare <form> inside a dialog.
 *
 * The dialog is a flex column whose body scrolls and whose footer is pinned.
 * A plain <form> wrapped around them becomes the flex child instead, and
 * because it has no height constraint it grows to fit its content — pushing
 * the footer, and the primary action, off the bottom of the screen.
 */
export function DialogForm({ className, ...props }: React.ComponentProps<"form">) {
  return <form className={cn("flex min-h-0 flex-1 flex-col", className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // `min-h-0` is what makes this actually scroll: a flex child will not
        // shrink below its content height without it, which would push the
        // footer — and the primary action button — off the bottom of the screen.
        "scrollbar-slim min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // shrink-0 keeps the action row pinned and always reachable.
        "flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-surface-2 px-5 py-4 sm:flex-row sm:justify-end",
        "pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4",
        className,
      )}
      {...props}
    />
  );
}
