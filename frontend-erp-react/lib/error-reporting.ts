import * as Sentry from "@sentry/nextjs";

/**
 * Single seam between the app's error boundaries (app/error.tsx,
 * app/global-error.tsx) and Sentry. `NEXT_PUBLIC_SENTRY_DSN` unset (local
 * dev default, see .env.example) means Sentry.init() never ran with a real
 * DSN, so captureException is a silent no-op — no separate on/off switch
 * needed here.
 */
export function reportError(error: Error & { digest?: string }): void {
  // Crash reporting, not the toast.error(errMsg(err)) pattern used for
  // expected mutation failures.
  console.error(error);
  Sentry.captureException(error);
}
