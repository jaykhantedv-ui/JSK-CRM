import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

/**
 * The seven feature modules of §18. A feature folder may import from `services`,
 * `lib`, `components/ui` and `components/shared` — but **never** from another
 * feature folder. Shared needs move to `components/shared` or `services`.
 *
 * Enforced with the ESLint core rule `no-restricted-imports`, which CLAUDE.md §16
 * permits as an equivalent to `import/no-restricted-paths` and which needs no
 * additional dependency. One override per feature, so the error message names the
 * offending boundary precisely.
 */
const FEATURES = [
  'accounts',
  'contacts',
  'projects',
  'opportunities',
  'activities',
  'dashboard',
  'import',
]

const featureBoundaries = FEATURES.map((feature) => ({
  files: [`src/features/${feature}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '@/features/*',
              '@/features/*/**',
              ...FEATURES.filter((other) => other !== feature).flatMap((other) => [
                `**/features/${other}`,
                `**/features/${other}/**`,
              ]),
            ],
            allowTypeImports: false,
            message:
              `src/features/${feature} must not import from another feature folder (§18). ` +
              'Move the shared code to src/services, src/lib, src/components/shared or ' +
              'src/components/ui. Within this feature, use a relative import.',
          },
        ],
      },
    ],
  },
}))

/**
 * The service-role client bypasses RLS. §15.7 and ADR-009 permit exactly three
 * callers: cron routes, the import executor, and the user-provisioning Server
 * Action (the last only after a server-side OWNER/ADMIN check).
 *
 * Everything else under src/ is denied at lint time. This is a build-time control
 * that complements — and does not replace — the runtime browser guard inside
 * admin.ts and the §19.4 bundle grep.
 */
const ADMIN_CLIENT_PERMITTED_CALLERS = [
  'src/app/api/cron/**/*.{ts,tsx}',
  'src/services/import.service.ts',
  'src/services/user.service.ts',
]

const adminClientBoundary = [
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/supabase/admin.ts', ...ADMIN_CLIENT_PERMITTED_CALLERS],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/supabase/admin', '@/lib/supabase/admin'],
              message:
                'The Supabase service-role client bypasses RLS and is restricted to cron routes, ' +
                'the import executor and the user-provisioning Server Action (§15.7, ADR-009). ' +
                'Use @/lib/supabase/server for user-scoped access, where RLS applies.',
            },
          ],
        },
      ],
    },
  },
]

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ...featureBoundaries,
  ...adminClientBoundary,
]

export default eslintConfig
