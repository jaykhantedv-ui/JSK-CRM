'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { isAppError } from '@/lib/errors'
import { landingRouteFor } from '@/lib/permissions'
import { emailSchema } from '@/lib/validation'
import { getCurrentUser, signIn, signOut } from '@/services/auth.service'

/**
 * Login and logout Server Actions.
 *
 * A Server Action does exactly four things (CLAUDE.md §8): authenticate,
 * validate with Zod, call a service, map errors. There are no business rules
 * here — "is this account allowed to sign in?" is answered in `auth.service.ts`
 * and, ultimately, by the database.
 */

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Enter your password.' }),
})

export type LoginState = { error: string | null }

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  // One message for every failure shape. Telling the user which field was wrong
  // tells an attacker which emails exist (§25).
  const GENERIC = 'Those details did not match an active account.'
  if (!parsed.success) return { error: GENERIC }

  try {
    await signIn(parsed.data.email, parsed.data.password)
  } catch (error) {
    return { error: isAppError(error) ? error.message : GENERIC }
  }

  const user = await getCurrentUser()
  if (!user) return { error: GENERIC }

  // Role-aware landing (§12.2). `redirect` throws, so it must sit outside the
  // try block above.
  redirect(landingRouteFor(user.role))
}

export async function logoutAction(): Promise<void> {
  await signOut()
  redirect('/login')
}
