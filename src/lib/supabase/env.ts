/**
 * Environment access for the Supabase clients.
 *
 * Nothing is hard-coded (§17.4). Each accessor fails loudly when its variable is
 * missing, so a misconfigured environment surfaces at the boundary rather than as
 * an opaque request failure later.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in — see docs/SETUP.md.`,
    )
  }
  return value
}

/** Project URL. Public: safe in a browser bundle. */
export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)
}

/**
 * Anon key. Public and safe to expose: RLS is what protects the data (§15.7).
 */
export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

/**
 * Service-role key. **Server only.** Never referenced from a module that can reach
 * a browser bundle — it is read exclusively by `admin.ts`, behind that module's
 * runtime guard.
 */
export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY)
}
