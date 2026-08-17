import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandLockup } from "@/components/brand-mark";
import { getCurrentUser } from "@/lib/auth";
import { getSettings, logoVersion } from "@/server/services/settings";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const settings = await getSettings();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BrandLockup cafeName={settings.cafeName} version={logoVersion(settings)} />
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-ink-faint">
          Authorised staff only. All sign-in attempts are recorded.
        </p>
      </div>
    </main>
  );
}
