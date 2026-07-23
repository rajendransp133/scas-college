import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Bundles only the `node_modules` subset actually needed at runtime into
  // `.next/standalone` — the production Docker image copies that instead of
  // the full node_modules tree.
  output: "standalone",
};

export default withSentryConfig(nextConfig, {
  // No Sentry project exists yet (see .env.example) — org/project/authToken
  // are undefined until one does, and the plugin skips the sourcemap-upload
  // step gracefully (a build-time warning, not a failure) rather than
  // requiring them.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: false,
});
