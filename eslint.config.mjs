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
]

export default eslintConfig
