"use client";

import { useEffect } from "react";
import "./globals.css";
import { reportError } from "@/lib/error-reporting";

/**
 * Catches errors thrown by the root layout itself (Providers, fonts, etc.) —
 * a different, rarer case than app/error.tsx, which only covers errors below
 * the root layout. Must render its own <html>/<body>: this replaces the root
 * layout entirely when active, so it can't assume Providers/QueryClient/auth
 * context are available and stays deliberately minimal.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center antialiased">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          The application hit an unexpected error. Try again, or reload the
          page.
        </p>
        <button
          onClick={() => unstable_retry()}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
