/**
 * A stand-in for the Supabase Auth admin API. TESTS ONLY — never deployed.
 *
 *   node scripts/lib/gotrue-stub.mjs <port> <database-url> <service-role-key> <log-file>
 *
 * WHY THIS EXISTS. `deploy/bootstrap-owner.sh` creates the first OWNER's account
 * through GoTrue's admin API, because GoTrue owns `auth.users` and the password
 * hashing in it — the bootstrap must never write that table by hand. GoTrue is a
 * container image, and the container registry is unreachable in this environment,
 * so the regression test substitutes THE SERVICE and nothing else: the real
 * script runs, against a real PostgreSQL carrying the real migrations, and the
 * `on_auth_user_created` trigger fires for real.
 *
 * It does what GoTrue does for the two routes the bootstrap uses, and no more:
 *
 *   GET    /auth/v1/health          liveness
 *   POST   /auth/v1/admin/users     insert auth.users with a bcrypt password
 *   DELETE /auth/v1/admin/users/:id remove one
 *
 * It ENFORCES the service-role key on the admin routes, so a script that failed
 * to send it would fail the test rather than quietly pass.
 *
 * Every request is appended to the log file as one JSON line, with the password
 * and the key REDACTED, so the test can assert which calls were made without
 * writing a secret to disk.
 */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import pg from 'pg'

const [port, databaseUrl, serviceRoleKey, logFile] = process.argv.slice(2)
const db = new pg.Client({ connectionString: databaseUrl })
await db.connect()

const record = (entry) => appendFileSync(logFile, JSON.stringify(entry) + '\n')

const send = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve(null)
      }
    })
  })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const authorized =
    req.headers['apikey'] === serviceRoleKey &&
    req.headers['authorization'] === `Bearer ${serviceRoleKey}`

  record({
    method: req.method,
    path: url.pathname,
    authorized,
    // Never the key itself, and never the password: this file is read by a test.
    sentApikeyHeader: Boolean(req.headers['apikey']),
    sentAuthorizationHeader: Boolean(req.headers['authorization']),
  })

  if (url.pathname === '/auth/v1/health') return send(res, 200, { name: 'gotrue-stub' })

  if (!url.pathname.startsWith('/auth/v1/admin/users')) return send(res, 404, { msg: 'not found' })
  if (!authorized) return send(res, 401, { msg: 'This endpoint requires a Bearer token' })

  if (req.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
    const body = await readBody(req)
    if (!body?.email || !body?.password) return send(res, 400, { msg: 'email and password are required' })

    const exists = await db.query('select id from auth.users where email = $1', [body.email])
    if (exists.rowCount > 0) return send(res, 422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' })

    // GoTrue hashes with bcrypt and confirms the address when email_confirm is
    // set. pgcrypto's blowfish crypt() is the same algorithm, so the stored row
    // has the shape the real service would have written.
    const inserted = await db.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $1,
               extensions.crypt($2, extensions.gen_salt('bf')),
               case when $3 then now() else null end,
               '{"provider":"email","providers":["email"]}'::jsonb, $4::jsonb)
       returning id, email, created_at`,
      [body.email, body.password, body.email_confirm === true, JSON.stringify(body.user_metadata ?? {})],
    )
    const user = inserted.rows[0]
    return send(res, 200, { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email })
  }

  if (req.method === 'DELETE') {
    const id = url.pathname.split('/').pop()
    try {
      await db.query('delete from auth.users where id = $1', [id])
      return send(res, 200, {})
    } catch (error) {
      // `public.users.id references auth.users(id) on delete restrict`, so this
      // is refused while a profile row exists — exactly as on a real server.
      return send(res, 500, { msg: String(error.message) })
    }
  }

  return send(res, 405, { msg: 'method not allowed' })
})

server.listen(Number(port), '127.0.0.1', () => process.stdout.write('ready\n'))

const shutdown = async () => {
  server.close()
  await db.end().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
