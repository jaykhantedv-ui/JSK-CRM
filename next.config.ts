import type { NextConfig } from 'next'

import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  // Self-hosting (ADR-033). `standalone` emits .next/standalone with a server.js
  // and only the node_modules actually reached at runtime, which is what the
  // production image copies. Without it the image needs the full dependency tree
  // — a few hundred megabytes of build-time packages shipped to an office PC for
  // no reason. It changes nothing about how the application runs.
  output: 'standalone',

  // §23. The Content-Security-Policy is NOT here: it carries a per-request nonce
  // and is set in middleware.ts. Everything that does not vary by request is set
  // here so it also covers the responses the middleware matcher skips —
  // `_next/static`, images and `favicon.ico`.
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }]
  },

  // §29. A Postgres error, a stack trace or a file path must never reach a user.
  // Next.js already withholds server stack traces in a production build; this
  // removes the framework's own version banner as well, which is free.
  poweredByHeader: false,
}

export default nextConfig
