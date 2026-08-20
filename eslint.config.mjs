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
  // Added in Master Phase 4. `management` shipped in Phase 3 without a boundary
  // entry, so §18's rule was not being enforced on it; `archive` and `settings`
  // arrive with this phase.
  'management',
  'archive',
  'settings',
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
  // The cron execution path. ADR-009 permits "cron routes"; CLAUDE.md §8 requires
  // the business logic to live in a service rather than in the route handler, so
  // the permitted caller is the service the routes call. The routes themselves
  // stay thin: authenticate, call, map.
  'src/services/automation.service.ts',
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

/**
 * `_previous` is the convention this repository already uses for a Server Action's
 * unused `prevState` argument, which `useActionState` requires in the signature.
 * The default `after-used` rule only complains when such an argument is LAST —
 * which it is for any action bound with `.bind(null, id)` — so the same name was
 * silent in some files and an error in others. One rule, applied consistently.
 */
const unusedArgs = [
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
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
  ...unusedArgs,
]

export default eslintConfig
