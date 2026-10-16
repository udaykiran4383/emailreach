import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  cleanupErrorBody,
  getGmailForUser,
  isAuthError,
  isInsufficientScopeError,
  mapWithConcurrency,
  GmailContext,
} from '@/lib/gmail/cleanup'
import { buildUnsubscribeRawMessage, planUnsubscribe, UnsubscribeMethod } from '@/lib/gmail/unsubscribe'
import { safeRequest } from '@/lib/net/safe-request'

export const maxDuration = 60

interface UnsubscribeResult {
  email: string
  method: UnsubscribeMethod
  ok: boolean
  url?: string
  error?: string
}

const MAX_SENDERS = 25
const POST_TIMEOUT_MS = 10_000

/** RFC 8058 one-click: POST "List-Unsubscribe=One-Click" to the https URL. Redirects are not followed. */
async function oneClickPost(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') throw new Error('One-click URL must be https')
  // safeRequest validates the host and pins the connection to the validated address
  const res = await safeRequest(url, {
    method: 'POST',
    timeoutMs: POST_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
    discardBody: true,
  })
  // 2xx is success; many senders answer with a redirect to a confirmation page
  if (res.status >= 400) throw new Error(`Sender responded ${res.status}`)
}

/** Headers are always re-read from the user's own mailbox, never taken from the client. */
async function unsubscribeSender(ctx: GmailContext, email: string): Promise<UnsubscribeResult> {
  const list = await ctx.gmail.users.messages.list({ userId: 'me', q: `from:(${email})`, maxResults: 1 })
  const id = list.data.messages?.[0]?.id
  if (!id) return { email, method: 'none', ok: false, error: 'No emails from this sender' }

  const msg = await ctx.gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'metadata',
    metadataHeaders: ['List-Unsubscribe', 'List-Unsubscribe-Post'],
  })
  const headers = msg.data.payload?.headers || []
  const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
  const plan = planUnsubscribe(header('List-Unsubscribe'), header('List-Unsubscribe-Post'))

  try {
    if (plan.method === 'one-click' && plan.url) {
      await oneClickPost(plan.url)
      return { email, method: 'one-click', ok: true }
    }
    if (plan.method === 'mailto' && plan.mailto) {
      await ctx.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: buildUnsubscribeRawMessage(ctx.email, plan.mailto) },
      })
      return { email, method: 'mailto', ok: true }
    }
    if (plan.method === 'manual' && plan.url) {
      // Never auto-open arbitrary links server-side: the user opens it themselves
      return { email, method: 'manual', ok: false, url: plan.url }
    }
    return { email, method: 'none', ok: false, error: 'This sender has no unsubscribe option' }
  } catch (err: any) {
    // Manual link as a fallback when one-click fails
    return { email, method: plan.method, ok: false, url: plan.url, error: err?.message || 'Unsubscribe failed' }
  }
}

/**
 * POST { senders: string[] | { email: string }[] }
 * Unsubscribes from each sender using the safest available method.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const senders: string[] = Array.from(new Set(
    (Array.isArray(body.senders) ? body.senders : [])
      .map((s: unknown) => (typeof s === 'string' ? s : (s as { email?: string })?.email || ''))
      .map((s: string) => s.trim().toLowerCase())
      .filter((s: string) => /^[^\s@()"]+@[^\s@()"]+\.[^\s@()"]+$/.test(s))
  ))

  if (senders.length === 0) return NextResponse.json({ error: 'No valid senders' }, { status: 400 })
  if (senders.length > MAX_SENDERS) {
    return NextResponse.json({ error: `At most ${MAX_SENDERS} senders per request` }, { status: 400 })
  }

  try {
    const ctx = await getGmailForUser(user.id)
    let scopeError: unknown = null
    const { results, truncated } = await mapWithConcurrency(senders, 5, Date.now() + 45_000, (email) =>
      unsubscribeSender(ctx, email).catch((err: any): UnsubscribeResult => {
        // Scope errors must surface as RECONNECT_REQUIRED, not per-sender failures
        if (isInsufficientScopeError(err) || isAuthError(err)) scopeError = err
        return { email, method: 'none', ok: false, error: err?.message || 'Failed' }
      })
    )
    if (scopeError && !results.some((r) => r.ok)) throw scopeError
    console.log(`[cleanup] Unsubscribe: ${results.filter((r) => r.ok).length}/${results.length} succeeded`)
    return NextResponse.json({ results, truncated })
  } catch (err: any) {
    const { status, body: errorBody } = cleanupErrorBody(err)
    return NextResponse.json(errorBody, { status })
  }
}
