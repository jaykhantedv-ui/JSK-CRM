# JSK CRM — production image for the office server (ADR-033).
#
# Multi-stage so the shipped image carries the built application and nothing
# else: no compilers, no dev dependencies, no source tree.
#
# NOTE ON BUILD ARGS. Next.js inlines every NEXT_PUBLIC_* value into the client
# bundle AT BUILD TIME, so they have to be present here rather than at `docker
# run`. They are not secrets — the anon key is designed to sit in a browser — but
# it does mean an image is built for one deployment's URL. `deploy/start.sh`
# passes them from the environment file, so a rebuild picks up a changed URL.
#
# The service-role key is deliberately NOT a build arg. It is read from the
# environment at runtime by server code only, and a build arg would bake it into
# the image layers where anyone with the image could read it (CLAUDE.md §7).

# --- deps --------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` needs the dev dependencies: the build runs TypeScript and Tailwind.
RUN npm ci --no-audit --no-fund

# --- builder -----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_DEMO_MODE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- runner ------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Kolkata

# Timezone data, so Intl.DateTimeFormat can render Asia/Kolkata. Alpine's Node
# ships a full-icu build, but the zone database itself is not in the base image
# and every date in this application is displayed in IST (CLAUDE.md §10).
RUN apk add --no-cache tzdata wget

# Never run the application as root.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# `standalone` already contains the server and the node_modules actually reached
# at runtime; the build's static assets are copied alongside it.
#
# There is deliberately no `COPY /app/public`. This application ships no public/
# directory — nothing is served from one — and BuildKit fails the entire build
# on a COPY whose source is absent ("/app/public": not found). Next.js serves
# public/ only when it exists, so there is nothing missing at runtime. If the
# directory is ever added, restore the copy here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Compose restarts the container when this fails; /api/health answers 503 rather
# than 200 when the database is unreachable, which is what makes that useful.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]
