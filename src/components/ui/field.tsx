"use client";

import * as React from "react";

import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-xs font-semibold tracking-wide text-ink-muted uppercase", className)}
      {...props}
    />
  );
}

const controlClasses =
  "w-full rounded-lg border border-line bg-surface-2 px-3 text-ink placeholder:text-ink-faint transition-colors hover:border-line-strong focus:border-gold focus:outline-none disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-11 text-base sm:text-sm", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-20 py-2 text-base sm:text-sm", className)} {...props} />;
}

/** Native select — faster and more reliable than a custom listbox on mobile. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(controlClasses, "h-11 appearance-none pr-8 text-base sm:text-sm", className)} {...props}>
      {children}
    </select>
  );
}

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | string[];
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-gold">*</span> : null}
      </Label>
      {children}
      {message ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/** Colour picker with a readable hex input beside it. */
export function ColorField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-surface-2 p-1"
        aria-label="Pick a colour"
      />
      <Input
        value={value.toUpperCase()}
        onChange={(event) => {
          const next = event.target.value;
          if (/^#[0-9a-fA-F]{0,6}$/.test(next)) onChange(next);
        }}
        className="font-mono uppercase"
        maxLength={7}
        aria-label="Colour hex code"
      />
    </div>
  );
}
