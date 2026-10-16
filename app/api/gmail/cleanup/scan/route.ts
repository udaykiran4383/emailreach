import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  CLEANUP_PRESETS,
  buildSafeQuery,
  buildBaseQuery,
  cleanupErrorBody,
  getGmailForUser,
  getProtectedEmails,
  hasModifyScope,
} from '@/lib/gmail/cleanup'

/** GET: does the connected Gmail token allow cleanup? */
export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const ctx = await getGmailForUser(user.id)
    return NextResponse.json({ connected: true, email: ctx.email, hasModifyScope: await hasModifyScope(ctx) })
  } catch (err: any) {
    if (err?.message === 'Gmail account not connected') {
      return NextResponse.json({ connected: false, hasModifyScope: false })
    }
    const { status, body } = cleanupErrorBody(err)
    if (body.error === 'RECONNECT_REQUIRED') return NextResponse.json({ connected: true, hasModifyScope: false })
    return NextResponse.json(body, { status })
  }
}

/** POST: approximate message counts per preset (Gmail estimates, not exact). */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { age } = await request.json().catch(() => ({}))

  try {
    const ctx = await getGmailForUser(user.id)
    const protectedEmails = await getProtectedEmails(user.id, ctx.email)

    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))

    const profilePromise = ctx.gmail.users.getProfile({ userId: 'me' })
    const presetPromises = CLEANUP_PRESETS.map(async (preset) => {
      const query = buildSafeQuery(buildBaseQuery({ presetId: preset.id, age }), protectedEmails)
      const res = await ctx.gmail.users.messages.list({ userId: 'me', q: query, maxResults: 1 })
      return { ...preset, query, estimate: res.data.resultSizeEstimate ?? 0 }
    })

    // Surface scope errors instead of timing out on them
    const profile = await profilePromise
    const settled = await Promise.race([Promise.allSettled(presetPromises), timeout])

    if (settled) {
      const scopeError = settled.find((r) => r.status === 'rejected')
      if (scopeError && scopeError.status === 'rejected') {
        const { body } = cleanupErrorBody(scopeError.reason)
        if (body.error === 'RECONNECT_REQUIRED') throw scopeError.reason
      }
    }

    const presets = settled
      ? settled.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { ...CLEANUP_PRESETS[i], query: '', estimate: null, error: 'Count failed' })
      : CLEANUP_PRESETS.map((p) => ({ ...p, query: '', estimate: null, error: 'Timed out' }))

    return NextResponse.json({
      email: ctx.email,
      messagesTotal: profile.data.messagesTotal ?? null,
      protectedCount: protectedEmails.length,
      presets,
    })
  } catch (err: any) {
    const { status, body } = cleanupErrorBody(err)
    return NextResponse.json(body, { status })
  }
}
