import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  test: {
    // Root-level, because it applies to the run rather than to one project.
    //
    // The integration files share one database, so running them concurrently
    // would have separate transactions touching the same fixture rows and
    // deadlocking for reasons unrelated to the rule under test. `false` also
    // pins the run to a single worker. The unit suite is fast enough that
    // sharing that worker costs nothing.
    fileParallelism: false,
    projects: [
      {
        // Pure logic, no database and no DOM (§19.1).
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
        resolve: { alias },
      },
      {
        // Database, constraints, triggers and every RLS rule (§19.2) — the most
        // important tests in the project.
        //
        // They run against a real PostgreSQL server (ADR-018). `globalSetup`
        // resets it once per run; each test then works inside a transaction it
        // rolls back, so the fixtures are identical for every test.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
        resolve: { alias },
      },
    ],
  },
})
