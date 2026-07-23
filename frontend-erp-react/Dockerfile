# syntax=docker/dockerfile:1
#
# SCAS ERP frontend — multi-stage build, Next.js "standalone" output.
#
# Requires next.config.ts to set `output: "standalone"` (added in a parallel
# pass alongside Sentry/error-boundary wiring) — without it `.next/standalone`
# won't exist and the runtime COPY below fails.

########################################
# Builder
########################################
FROM node:22-alpine AS builder
# Alpine (musl libc) chosen over node:22-slim (Debian/glibc) for the smaller
# image: this app's deps (axios, @tanstack/react-query, lucide-react, sonner,
# @base-ui/react, shadcn) are pure JS/TS with no native addons that need
# node-gyp or glibc. If a future dependency adds a native binding that only
# ships glibc binaries, switch the two `FROM node:22-alpine` lines to
# `node:22-slim` instead.

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Next.js inlines `NEXT_PUBLIC_*` env vars into the client bundle at *build*
# time, not read at request time — so the value has to be available as a
# build ARG here, and the image must be rebuilt whenever it changes (see
# ../DEPLOY.md). ENV (not just ARG) is required too: `next build` reads
# `process.env`, and ARG alone isn't exported into the process environment
# of subsequent RUN steps.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

########################################
# Runtime — copy only the standalone server output, non-root user.
########################################
FROM node:22-alpine

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `.next/standalone` is a self-contained server.js + a trimmed
# node_modules (only what's actually imported at runtime) produced by
# `output: "standalone"`; static assets and public/ are not included in it
# and must be copied alongside.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app

EXPOSE 3000

CMD ["node", "server.js"]
