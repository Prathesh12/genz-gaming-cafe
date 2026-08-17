import type { Metadata, Viewport } from "next";

import { Toaster } from "sonner";

import "./globals.css";

/**
 * The UI uses the platform's native UI font stack (see --font-sans in
 * globals.css). It renders instantly, needs no network request at build or
 * runtime, and looks native on Windows counters, Android tablets and iPhones
 * alike. To use a webfont instead, add `next/font` here and point
 * `--font-sans` at it.
 */

export const metadata: Metadata = {
  title: {
    default: "GENZ Gaming Cafe",
    template: "%s · GENZ Gaming Cafe",
  },
  description: "Gaming cafe management and point of sale — stations, sessions, food, payments and income.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "GENZ Cafe", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <Toaster
          position="top-center"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "#181818",
              border: "1px solid #333333",
              color: "#ffffff",
            },
          }}
        />
      </body>
    </html>
  );
}
