"use client";

import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-gold text-black hover:bg-gold-bright active:bg-gold-dim",
        secondary: "bg-surface-3 text-ink hover:bg-line-strong border border-line",
        outline: "border border-line-strong bg-transparent text-ink hover:bg-surface-2",
        ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
        danger: "bg-danger text-white hover:bg-danger/85",
        success: "bg-ok text-black hover:bg-ok/85",
        link: "text-gold underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-9 px-3 text-sm [&_svg]:size-4",
        md: "h-11 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-5 text-base [&_svg]:size-5",
        // Deliberately tall: the primary counter actions must be easy to hit
        // on a phone or a greasy tablet screen.
        touch: "h-14 px-5 text-base [&_svg]:size-5 w-full",
        icon: "h-10 w-10 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span>{children}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { buttonVariants };
