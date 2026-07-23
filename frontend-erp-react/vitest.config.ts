import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Unit/component test config (Vitest), separate from the Next.js/Turbopack
// build pipeline used by `next dev`/`next build`. Mirrors tsconfig.json's
// `@/*` -> project-root path alias so test files can import with the same
// paths the app code uses.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
