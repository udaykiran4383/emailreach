import { google, gmail_v1 } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

/**
 * Gmail inbox cleanup. Everything here moves mail to Trash (Gmail empties it
 * after 30 days) — nothing is ever permanently deleted, and the gmail.modify
 * scope we request cannot permanently delete anyway.
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export const MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

export class ReconnectRequiredError extends Error {
  constructor(message = 'RECONNECT_REQUIRED') {
    super(message)
  }
}

export interface CleanupPreset {
  id: string
  label: string
  description: string
  query: string
}

export const CLEANUP_PRESETS: CleanupPreset[] = [
  { id: 'promotions', label: 'Promotions', description: 'Gmail’s Promotions tab: offers, deals, marketing', query: 'category:promotions' },
  { id: 'social', label: 'Social', description: 'Notifications from social networks', query: 'category:social' },
  { id: 'updates', label: 'Old updates', description: 'Receipts, notifications and alerts older than 3 months', query: 'category:updates older_than:3m' },
  { id: 'forums', label: 'Forums', description: 'Mailing lists and discussion groups', query: 'category:forums' },
  { id: 'newsletters', label: 'Newsletters', description: 'Anything with an unsubscribe link, outside Primary, older than 1 month', query: '"unsubscribe" older_than:1m -category:primary' },
  { id: 'old_unread', label: 'Old unread', description: 'Unread for more than 6 months', query: 'is:unread older_than:6m' },
  { id: 'large_old', label: 'Large & old', description: 'Bigger than 5 MB and older than 1 year', query: 'larger:5M older_than:1y' },
  { id: 'all_old', label: 'Very old (non-Primary)', description: 'Everything outside Primary older than 2 years', query: 'older_than:2y -category:primary' },
]

export const AGE_FILTERS = ['any', '1m', '3m', '6m', '1y', '2y'] as const
export type AgeFilter = (typeof AGE_FILTERS)[number]

const SAFETY_SUFFIX = '-is:starred -is:important -in:sent -in:drafts -in:chats -label:emailreach-keep'
const MAX_PROTECTED = 150

/** Appends the safety exclusions (and protected senders) to a Gmail search query. */
export function buildSafeQuery(base: string, protectedEmails: string[] = []): string {
  const parts = [base.trim(), SAFETY_SUFFIX]
  const emails = Array.from(new Set(
    protectedEmails
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@()"]+@[^\s@()"]+\.[^\s@()"]+$/.test(e))
  )).slice(0, MAX_PROTECTED)
  if (emails.length > 0) parts.push(`-from:(${emails.join(' OR ')})`)
  return parts.filter(Boolean).join(' ')
}

/** Base query for a preset / custom query / sender list plus an optional age filter. Throws on an empty query. */
export function buildBaseQuery(opts: { presetId?: string; query?: string; senders?: string[]; age?: string }): string {
  const parts: string[] = []
  if (opts.presetId) {
    const preset = CLEANUP_PRESETS.find((p) => p.id === opts.presetId)
    if (!preset) throw new Error('Unknown preset')
    parts.push(preset.query)
  }
  const custom = (opts.query || '').trim()
  if (custom) parts.push(custom)
  const senders = (opts.senders || []).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@') && !/[\s()"]/.test(s))
  if (senders.length > 0) parts.push(`from:(${senders.join(' OR ')})`)
  // Without a preset, senders or a positive search term the query would match
  // most of the mailbox (an age filter alone is too broad)
  const positive = parts.join(' ').split(/\s+/).filter((t) => t && !t.startsWith('-'))
  if (positive.length === 0) throw new Error('Refusing to run with an empty query — pick a preset, senders, or a search query')

  if (opts.age && opts.age !== 'any') {
    if (!(AGE_FILTERS as readonly string[]).includes(opts.age)) throw new Error('Invalid age filter')
    parts.push(`older_than:${opts.age}`)
  }
  return parts.join(' ').trim()
}

export function isInsufficientScopeError(err: any): boolean {
  const msg = String(err?.message || '') + JSON.stringify(err?.response?.data || err?.errors || '')
  return (
    err?.code === 403 && /insufficient|scope/i.test(msg)
  ) || /insufficient authentication scopes|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg)
}

export function isAuthError(err: any): boolean {
  return /invalid_grant|invalid_token|unauthorized_client/i.test(String(err?.message || ''))
}

export interface GmailContext {
  gmail: gmail_v1.Gmail
  email: string
  accessToken: string
  auth: InstanceType<typeof google.auth.OAuth2>
}

export async function getGmailForUser(userId: string): Promise<GmailContext> {
  const { data: cred, error } = await supabaseAdmin
    .from('gmail_credentials')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !cred) throw new Error('Gmail account not connected')

  const auth = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET)
  auth.setCredentials({
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    expiry_date: cred.token_expiry ? new Date(cred.token_expiry).getTime() : undefined,
  })

  // Persist refreshed tokens so the next request doesn't refresh again
  auth.on('tokens', (tokens) => {
    if (!tokens.access_token) return
    supabaseAdmin
      .from('gmail_credentials')
      .update({
        access_token: tokens.access_token,
        token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cred.id)
      .then(({ error: updateError }) => {
        if (updateError) console.warn('[cleanup] Failed to persist refreshed token:', updateError.message)
      })
  })

  return {
    gmail: google.gmail({ version: 'v1', auth }),
    email: cred.email_address,
    accessToken: cred.access_token,
    auth,
  }
}

/** True when the stored token carries the gmail.modify scope. */
export async function hasModifyScope(ctx: GmailContext): Promise<boolean> {
  const { token } = await ctx.auth.getAccessToken()
  if (!token) return false
  const info = await ctx.auth.getTokenInfo(token)
  return (info.scopes || []).includes(MODIFY_SCOPE) || (info.scopes || []).includes('https://mail.google.com/')
}

/**
 * Addresses that must never be cleaned: the user's own address and every
 * campaign contact who replied.
 */
export async function getProtectedEmails(userId: string, ownEmail?: string): Promise<string[]> {
  const emails = new Set<string>()
  if (ownEmail) emails.add(ownEmail.toLowerCase())

  const { data, error } = await supabaseAdmin
    .from('email_recipients')
    .select('email, reply_from, status, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .or('status.eq.replied,reply_from.not.is.null')
    .limit(1000)

  if (error) {
    console.warn('[cleanup] Could not load protected contacts:', error.message)
  }

  for (const row of data || []) {
    if (row.email) emails.add(String(row.email).toLowerCase())
    const fromMatch = String(row.reply_from || '').match(/<([^>]+)>/)
    if (fromMatch) emails.add(fromMatch[1].toLowerCase())
  }

  return Array.from(emails)
}

/** Builds the final safe query for a user. */
export async function buildUserQuery(
  ctx: GmailContext,
  userId: string,
  opts: { presetId?: string; query?: string; senders?: string[]; age?: string }
): Promise<string> {
  const base = buildBaseQuery(opts)
  const protectedEmails = await getProtectedEmails(userId, ctx.email)
  return buildSafeQuery(base, protectedEmails)
}

/**
 * Applies a label change to every message matching `query`, time-boxed.
 * Always re-lists the first page: modified messages drop out of the results.
 */
export async function modifyMatching(
  gmail: gmail_v1.Gmail,
  query: string,
  change: { addLabelIds: string[]; removeLabelIds: string[] },
  opts: { includeSpamTrash?: boolean; timeBudgetMs?: number } = {}
): Promise<{ modified: number; remaining: boolean }> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 8000)
  const seen = new Set<string>()
  let modified = 0

  while (Date.now() < deadline) {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      includeSpamTrash: opts.includeSpamTrash,
    })
    const ids = (list.data.messages || []).map((m) => m.id!).filter((id) => id && !seen.has(id))

    if (ids.length === 0) {
      // Nothing left, or only already-processed ids came back (search index lag) — stop either way
      return { modified, remaining: false }
    }

    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000)
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: { ids: chunk, ...change },
      })
      chunk.forEach((id) => seen.add(id))
      modified += chunk.length
    }

    if (!list.data.nextPageToken && ids.length < 500) {
      return { modified, remaining: false }
    }
  }

  return { modified, remaining: true }
}

export function parseFromHeader(value: string): { email: string; name: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/)
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() }
  return { name: '', email: value.trim().toLowerCase() }
}

/** Runs `fn` over items with bounded concurrency, stopping early at the deadline. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  deadline: number,
  fn: (item: T) => Promise<R>
): Promise<{ results: R[]; truncated: boolean }> {
  const results: R[] = []
  let index = 0
  let truncated = false

  const worker = async () => {
    while (index < items.length) {
      if (Date.now() > deadline) {
        truncated = true
        return
      }
      const item = items[index++]
      try {
        results.push(await fn(item))
      } catch {
        // skip a single failed item
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { results, truncated }
}

/** Maps a cleanup error to an HTTP status + JSON body. */
export function cleanupErrorBody(err: any): { status: number; body: { error: string; message?: string } } {
  if (err instanceof ReconnectRequiredError || isInsufficientScopeError(err) || isAuthError(err)) {
    return {
      status: 403,
      body: { error: 'RECONNECT_REQUIRED', message: 'Reconnect Gmail to grant inbox cleanup access.' },
    }
  }
  if (err?.message === 'Gmail account not connected') {
    return { status: 400, body: { error: 'GMAIL_NOT_CONNECTED', message: err.message } }
  }
  if (/empty query|Unknown preset|Invalid age/.test(err?.message || '')) {
    return { status: 400, body: { error: err.message } }
  }
  console.error('[cleanup] Error:', err?.message || err)
  return { status: 500, body: { error: err?.message || 'Cleanup failed' } }
}
