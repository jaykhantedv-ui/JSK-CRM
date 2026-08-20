import { execFileSync } from 'node:child_process'

/**
 * Reset the database ONCE per run of the integration suite.
 *
 * Every test then works inside a transaction it rolls back, so the fixture set is
 * identical for each one and no test depends on another's order. Doing the reset
 * per file instead would have several files racing to drop the same database.
 */
export default function setup() {
  execFileSync('scripts/db.sh', ['reset'], {
    env: { ...process.env, FIXTURES: '1' },
    stdio: 'inherit',
  })
}
