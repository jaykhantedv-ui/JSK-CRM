import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  test: {
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
        // Database, constraints, triggers and every RLS rule (§19.2).
        // Requires `supabase start`; the suite itself arrives in Phase 3.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
        resolve: { alias },
      },
    ],
  },
})
