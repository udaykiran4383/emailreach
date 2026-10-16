import { createClient } from '@supabase/supabase-js'
import type { gmail_v1 } from 'googleapis'
import { extractMessageText } from '@/lib/email/bounces'
import { handleIncomingReply, type ReplyRecipient } from '@/lib/email/replies'

/**
 * Reply sync with one inbox listing per user instead of one Gmail call per recipient:
 *   1. list incoming mail since the oldest active send (or since the last sync watermark)
 *   2. drop messages already classified
 *   3. read headers only, and fetch the full body only for senders that are campaign recipients
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const MAX_MESSAGES = 300
const MAX_LOOKBACK_DAYS = 30
const CONCURRENCY = 10
// Re-scan a little before the watermark; handleIncomingReply is idempotent
const WATERMARK_OVERLAP_MS = 10 * 60 * 1000

interface SyncRecipient extends ReplyRecipient {
  sent_at: string | null
  gmail_thread_id: string | null
}

export interface ReplySyncResult {
  scanned: number
  updated: number
  replied: number
  unsubscribed: number
  truncated: boolean
  errors: string[]
}

export interface ReplySyncOptions {
  /** Only these campaigns (manual "Sync Status"); default = all active campaigns of the user */
  campaignIds?: string[]
  /** Narrow the listing with the stored watermark and advance it afterwards (cron) */
  useWatermark?: boolean
}

const header = (msg: gmail_v1.Schema$Message, name: string) =>
  msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value || ''

function emailFromHeader(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()
}

async function loadRecipients(userId: string, campaignIds?: string[]): Promise<SyncRecipient[]> {
  let campaignQuery = supabaseAdmin.from('campaigns').select('id').eq('user_id', userId)
  campaignQuery = campaignIds?.length
    ? campaignQuery.in('id', campaignIds)
    : campaignQuery.in('status', ['scheduled', 'sending', 'sent', 'paused'])
  const { data: campaigns, error } = await campaignQuery
  if (error) throw new Error(error.message)
  const ids = (campaigns || []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return []

  const rows: SyncRecipient[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: recipientsError } = await supabaseAdmin
      .from('email_recipients')
      .select('id, campaign_id, email, status, replied_at, sent_at, gmail_thread_id')
      .in('campaign_id', ids)
      .in('status', ['sent', 'replied'])
      .range(from, from + 999)
    if (recipientsError) throw new Error(recipientsError.message)
    rows.push(...((data || []) as SyncRecipient[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function getWatermark(userId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('sender_settings')
    .select('last_reply_sync_at')
    .eq('user_id', userId)
    .maybeSingle()
  // Column missing before scripts/14 is applied: no watermark
  if (error || !data?.last_reply_sync_at) return null
  return new Date(data.last_reply_sync_at).getTime()
}

async function setWatermark(userId: string, at: Date) {
  const { error } = await supabaseAdmin
    .from('sender_settings')
    .update({ last_reply_sync_at: at.toISOString() })
    .eq('user_id', userId)
  if (error && !/last_reply_sync_at/.test(error.message)) {
    console.warn('Could not store reply sync watermark:', error.message)
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]
        await fn(item)
      }
    })
  )
}

/** Picks which campaign recipient a message belongs to when the address is in several campaigns. */
function pickRecipient(candidates: SyncRecipient[], threadId: string | null | undefined): SyncRecipient {
  const inThread = threadId ? candidates.find((r) => r.gmail_thread_id === threadId) : undefined
  if (inThread) return inThread
  return [...candidates].sort((a, b) => (b.sent_at || '').localeCompare(a.sent_at || ''))[0]
}

export async function syncRepliesForUser(
  gmail: gmail_v1.Gmail,
  userId: string,
  options: ReplySyncOptions = {}
): Promise<ReplySyncResult> {
  const result: ReplySyncResult = { scanned: 0, updated: 0, replied: 0, unsubscribed: 0, truncated: false, errors: [] }
  const startedAt = new Date()

  const recipients = await loadRecipients(userId, options.campaignIds)
  if (recipients.length === 0) return result

  const byEmail = new Map<string, SyncRecipient[]>()
  let oldestSend = Date.now()
  for (const r of recipients) {
    const key = r.email.trim().toLowerCase()
    byEmail.set(key, [...(byEmail.get(key) || []), r])
    if (r.sent_at) oldestSend = Math.min(oldestSend, new Date(r.sent_at).getTime())
  }

  const days = Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.ceil((Date.now() - oldestSend) / 86_400_000) + 1))
  let q = `-in:sent -in:chats newer_than:${days}d`
  if (options.useWatermark) {
    const watermark = await getWatermark(userId)
    if (watermark) q += ` after:${Math.floor((watermark - WATERMARK_OVERLAP_MS) / 1000)}`
  }

  // 1. One listing (paginated) of incoming mail
  const ids: string[] = []
  try {
    let pageToken: string | undefined
    do {
      const resp = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: Math.min(100, MAX_MESSAGES - ids.length),
        pageToken,
      })
      for (const m of resp.data.messages || []) if (m.id) ids.push(m.id)
      pageToken = resp.data.nextPageToken || undefined
    } while (pageToken && ids.length < MAX_MESSAGES)
    result.truncated = Boolean(pageToken)
  } catch (err) {
    result.errors.push(`Failed to list messages: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  // 2. Skip messages that were already classified
  const done = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('email_replies')
      .select('gmail_message_id')
      .in('gmail_message_id', ids.slice(i, i + 100))
      .not('classification', 'is', null)
    for (const row of data || []) done.add(row.gmail_message_id)
  }
  // Oldest first, so an auto reply is recorded before a later real reply
  const pending = ids.filter((id) => !done.has(id)).reverse()
  result.scanned = pending.length

  // 3. Headers for everything, full body only for recipients
  const matches: { id: string; msg: gmail_v1.Schema$Message; recipient: SyncRecipient }[] = []
  await mapLimit(pending, CONCURRENCY, async (id) => {
    try {
      const meta = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      })
      const from = header(meta.data, 'from')
      if (/mailer-daemon|postmaster/i.test(from)) return // handled by the bounce scan
      if (meta.data.labelIds?.includes('SENT')) return
      const candidates = byEmail.get(emailFromHeader(from))
      if (!candidates) return
      matches.push({ id, msg: meta.data, recipient: pickRecipient(candidates, meta.data.threadId) })
    } catch (err) {
      result.errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // handleIncomingReply updates the recipient row; process sequentially in date order
  matches.sort((a, b) => Number(a.msg.internalDate || 0) - Number(b.msg.internalDate || 0))
  for (const { id, msg, recipient } of matches) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
      const internalDate = full.data.internalDate || msg.internalDate
      const handled = await handleIncomingReply(userId, recipient, {
        gmailMessageId: id,
        threadId: full.data.threadId || msg.threadId,
        from: header(full.data, 'from') || header(msg, 'from'),
        subject: header(full.data, 'subject') || header(msg, 'subject'),
        snippet: full.data.snippet || msg.snippet || '',
        body: extractMessageText(full.data.payload).slice(0, 20000) || undefined,
        receivedAt: internalDate ? new Date(parseInt(internalDate)).toISOString() : new Date().toISOString(),
      })
      if (handled.status !== 'recorded') continue
      result.updated++
      if (handled.isNewReply) {
        result.replied++
        // Same address in this run: later messages see the new status
        for (const r of byEmail.get(recipient.email.trim().toLowerCase()) || []) {
          if (r.id === recipient.id) r.status = 'replied'
        }
      }
      if (handled.unsubscribed) result.unsubscribed++
    } catch (err) {
      result.errors.push(`${recipient.email}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Only advance when everything up to now was seen
  if (options.useWatermark && !result.truncated && result.errors.length === 0) {
    await setWatermark(userId, startedAt)
  }
  return result
}
