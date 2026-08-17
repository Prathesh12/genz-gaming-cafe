import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <p className="text-5xl font-black text-gold">404</p>
      <h1 className="text-xl font-bold text-ink">That page does not exist</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        The link may be out of date, or the record was removed.
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-gold-bright"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
