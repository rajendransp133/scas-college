import * as Sentry from "@sentry/nextjs";

// Empty NEXT_PUBLIC_SENTRY_DSN (local dev default, see .env.example) means
// the SDK silently no-ops — this file doesn't need its own on/off switch.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
