import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The smoke suite never signs in (ADR-018 — Supabase Auth cannot run here),
      // so these only need to be present and well-formed. The Supabase client is
      // constructed, its call to an unreachable auth server fails, no user
      // resolves, and the middleware redirects — which is exactly the path under
      // test. A real project's values come from .env.local.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'e2e-smoke-anon-key',
      // The cron suite is the one part of §19.3 that needs NO Supabase session:
      // `/api/cron/*` authenticates by shared secret, so its refusal and its
      // response contract are genuinely testable here. A well-formed value is
      // all that is required — the secret guards the route, it does not reach
      // any external service.
      CRON_SECRET: process.env.CRON_SECRET ?? 'e2e-cron-secret-value',
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-service-role-key',
    },
  },
})
