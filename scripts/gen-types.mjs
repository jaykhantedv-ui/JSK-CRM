/**
 * Generate src/types/database.types.ts from a live database (ADR-018).
 *
 * This calls the SAME generator the `supabase gen types` container runs —
 * `@supabase/postgres-meta`, pinned to the version of the image the CLI pulls —
 * as a library rather than through Docker, because the container registry is
 * unreachable under this environment's egress policy.
 *
 * The output is generated from the ACTUAL database. It is never hand-written and
 * never hand-edited; regenerate it instead.
 *
 *   node scripts/gen-types.mjs [db-url] [out-file]
 */
import { writeFile } from 'node:fs/promises'
import { PostgresMeta } from '@supabase/postgres-meta/dist/lib/index.js'
import { getGeneratorMetadata } from '@supabase/postgres-meta/dist/lib/generators.js'
import { apply as applyTypescriptTemplate } from '@supabase/postgres-meta/dist/server/templates/typescript.js'

const connectionString =
  process.argv[2] ?? process.env.DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54322/postgres'
const outFile = process.argv[3] ?? 'src/types/database.types.ts'

const pgMeta = new PostgresMeta({ connectionString, max: 1 })
const { data, error } = await getGeneratorMetadata(pgMeta, { includedSchemas: ['public'] })
if (error) {
  console.error('Type generation failed:', error)
  process.exit(1)
}

const types = await applyTypescriptTemplate({ ...data, detectOneToOneRelationships: true })
await writeFile(outFile, types)
await pgMeta.end()

console.log(`Wrote ${outFile} from ${connectionString.replace(/:[^:@/]*@/, ':***@')}`)
