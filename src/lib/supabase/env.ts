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
 * Where **server-side** code reaches Supabase (ADR-033, self-hosting).
 *
 * The browser and the application container do not share a network. A browser on
 * the office LAN reaches the gateway at `NEXT_PUBLIC_SUPABASE_URL` — `http://localhost`
 * or the tunnel hostname — and inside the `app` container that address is either
 * the container itself or a host port bound to 127.0.0.1 that the container
 * cannot reach. Every Server Component read, Server Action, middleware refresh
 * and health probe would fail against it.
 *
 * `SUPABASE_INTERNAL_URL` is the container-internal address of the same gateway
 * (`http://gateway:8000`). It is deliberately NOT `NEXT_PUBLIC_`: it must never be
 * inlined into a browser bundle, where it would be unreachable and misleading.
 *
 * It falls back to the public URL when unset, so local development against the
 * Supabase CLI and any hosted-Supabase deployment behave exactly as before.
 */
export function supabaseInternalUrl(): string {
  return process.env.SUPABASE_INTERNAL_URL?.trim() || supabaseUrl()
}

/**
 * The session cookie name, pinned for browser and server alike.
 *
 * supabase-js otherwise derives its storage key from the URL it was given —
 * `sb-${hostname.split('.')[0]}-auth-token`. With the browser on
 * `NEXT_PUBLIC_SUPABASE_URL` and the server on `SUPABASE_INTERNAL_URL`, that
 * derivation yields two DIFFERENT cookie names, and the server would never find
 * the session the browser wrote: every user would appear signed out to every
 * Server Component while looking signed in to the browser.
 *
 * Pinning one literal name on both sides is what makes the split URL safe. It is
 * a constant rather than an environment variable on purpose — the two values must
 * be identical, and a variable is a way for them to drift apart.
 */
export const AUTH_COOKIE_NAME = 'sb-jsk-auth-token'

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
