import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

/**
 * Debug / one-off maintenance routes: hidden (404) in production unless
 * ENABLE_DEBUG_ROUTES=true, and always require a signed-in user.
 * Returns a response to send back, or the user when access is allowed.
 */
export async function guardDebugRoute(): Promise<
  { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUser>>> } | { ok: false; response: NextResponse }
> {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEBUG_ROUTES !== 'true') {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  const user = await getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, user }
}
