"use client";

import { useActionState, useEffect } from "react";

import { AlertCircle, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { loginAction } from "@/server/actions/auth";

export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, null);

  useEffect(() => {
    if (state?.ok) {
      router.replace("/dashboard");
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={state?.ok === false ? state.fieldErrors?.email : undefined}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoFocus
              required
              placeholder="you@genzcafe.in"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            error={state?.ok === false ? state.fieldErrors?.password : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
            />
          </Field>

          {state?.ok === false ? (
            <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {state.error}
            </p>
          ) : null}

          <Button type="submit" size="lg" loading={pending} className="mt-1">
            <LogIn aria-hidden />
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
