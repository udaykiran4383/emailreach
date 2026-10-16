import type { gmail_v1 } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

// Service-role client: the scan runs from cron as well as from user requests
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const EMAIL_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi

const UNSUBSCRIBE_RE = /\b(unsubscribe|remove me|stop (emailing|contacting)|take me off)\b/i

/** True when a reply asks not to be contacted again. */
export function isUnsubscribeIntent(text: string): boolean {
  return UNSUBSCRIBE_RE.test(text || '')
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return msg.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || ''
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8')
}

/** Recursively collects the decoded text of every text/* and message/* part. */
export function extractMessageText(part?: gmail_v1.Schema$MessagePart): string {
  if (!part) return ''
  let text = ''
  const mime = (part.mimeType || '').toLowerCase()
  if (part.body?.data && (mime.startsWith('text/') || mime.startsWith('message/') || mime === '')) {
    text += decodeBase64Url(part.body.data) + '\n'
  }
  for (const child of part.parts || []) {
    text += extractMessageText(child)
  }
  return text
}

function extractAddress(value: string): string {
  const match = value.match(/<([^>]+)>/)
  return (match ? match[1] : value).trim().toLowerCase()
}

interface BounceInfo {
  recipients: string[]
  hard: boolean
  diagnostic: string
}

/**
 * Works out who bounced and whether it is permanent. Gmail's own bounces carry
 * X-Failed-Recipients; standard DSNs carry Final-Recipient + Status lines.
 */
function parseBounce(msg: gmail_v1.Schema$Message, body: string): BounceInfo {
  const recipients = new Set<string>()

  header(msg, 'X-Failed-Recipients')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.includes('@'))
    .forEach(r => recipients.add(r))

  for (const m of body.matchAll(/^(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gim)) {
    recipients.add(m[1].toLowerCase())
  }

  // Enhanced status codes: 5.x.x permanent, 4.x.x temporary
  const statusMatch = body.match(/^Status:\s*([245])\.\d{1,3}\.\d{1,3}/im)
  const smtpMatch = body.match(/\b(5\d\d|4\d\d)[ -]\d\.\d{1,3}\.\d{1,3}\b/) || body.match(/\b(55[0-4]|5[0-4]\d|4[25]\d)\b/)
  const diagMatch = body.match(/^Diagnostic-Code:\s*(.+)$/im)

  let hard: boolean
  if (statusMatch) {
    hard = statusMatch[1] === '5'
  } else if (smtpMatch) {
    hard = smtpMatch[1].startsWith('5')
  } else {
    // Gmail bounce without a DSN part: the subject says whether it was a failure or a delay
    const subject = header(msg, 'Subject').toLowerCase()
    hard = !/delay|delayed|temporar|will retry|still trying/.test(subject + ' ' + body.slice(0, 2000).toLowerCase())
  }

  const diagnostic = (diagMatch?.[1] ||
    body.match(/(address (?:not found|couldn't be found)[^\n]*|user unknown[^\n]*|mailbox (?:unavailable|not found|does not exist)[^\n]*|no such user[^\n]*)/i)?.[1] ||
    'Delivery failed').trim().slice(0, 200)

  return { recipients: [...recipients], hard, diagnostic }
}

async function listMessageIds(gmail: gmail_v1.Gmail, q: string, max: number): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: Math.min(100, max - ids.length), pageToken })
    for (const m of res.data.messages || []) if (m.id) ids.push(m.id)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken && ids.length < max)
  return ids
}

/** Recipient rows (across all of the user's campaigns) for the given addresses. */
async function findUserRecipients(userId: string, emails: string[]) {
  if (emails.length === 0) return []
  const variants = [...new Set(emails.flatMap(e => [e, e.toLowerCase()]))]
  const { data, error } = await supabaseAdmin
    .from('email_recipients')
    .select('id, email, status, campaign_id, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .in('email', variants)
  if (error) throw new Error(error.message)
  return (data || []) as Array<{ id: string; email: string; status: string; campaign_id: string }>
}

/** Blocks an address and stops it from being sent to in any of the user's campaigns. */
export async function blockAddressForUser(
  userId: string,
  email: string,
  reason: 'bounced' | 'unsubscribed',
  diagnostic?: string
): Promise<number> {
  const normalized = email.toLowerCase().trim()
  const rows = await findUserRecipients(userId, [normalized])
  const matched = rows.filter(r => r.email.toLowerCase().trim() === normalized)

  await supabaseAdmin.from('blocked_emails').upsert({
    email: normalized,
    reason,
    source_campaign_id: matched[0]?.campaign_id || null,
    blocked_at: new Date().toISOString(),
  }, { onConflict: 'email' })

  let changed = 0
  const now = new Date().toISOString()
  for (const r of matched) {
    if (reason === 'bounced' && r.status === 'sent') {
      await supabaseAdmin.from('email_recipients').update({
        status: 'bounced',
        bounced_at: now,
        error_message: `Bounced: ${diagnostic || 'Delivery failed'}`,
        updated_at: now,
      }).eq('id', r.id)
      changed++
    } else if (r.status === 'pending' || r.status === 'uncertain') {
      await supabaseAdmin.from('email_recipients').update({
        status: 'skipped',
        error_message: `Blocked: ${reason}`,
        updated_at: now,
      }).eq('id', r.id)
      changed++
    }
  }
  return changed
}

/**
 * Scans the connected Gmail inbox for hard bounces and unsubscribe requests and
 * blocks those addresses. Idempotent: re-running only re-applies the same state.
 */
export async function scanInboxForBounces(
  gmail: gmail_v1.Gmail,
  userId: string
): Promise<{ bounced: number; unsubscribed: number; errors: string[] }> {
  const errors: string[] = []
  let bounced = 0
  let unsubscribed = 0

  // 1. Bounces
  try {
    const ids = await listMessageIds(gmail, 'from:(mailer-daemon OR postmaster) newer_than:14d', 200)
    const bounces: BounceInfo[] = []

    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10)
      const msgs = await Promise.all(batch.map(id =>
        gmail.users.messages.get({ userId: 'me', id, format: 'full' }).then(r => r.data).catch(() => null)
      ))
      for (const msg of msgs) {
        if (!msg) continue
        const body = extractMessageText(msg.payload)
        const info = parseBounce(msg, body)
        if (!info.hard) continue
        if (info.recipients.length === 0) {
          // No machine-readable recipient: fall back to addresses in the text we actually emailed
          const candidates = [...new Set((body.match(EMAIL_RE) || []).map(e => e.toLowerCase()))]
            .filter(e => !/mailer-daemon|postmaster|googlemail\.com$/.test(e))
          info.recipients = candidates
        }
        bounces.push(info)
      }
    }

    const allCandidates = [...new Set(bounces.flatMap(b => b.recipients))]
    const known = new Set((await findUserRecipients(userId, allCandidates)).map(r => r.email.toLowerCase().trim()))

    const handled = new Set<string>()
    for (const b of bounces) {
      for (const email of b.recipients) {
        if (!known.has(email) || handled.has(email)) continue
        handled.add(email)
        try {
          bounced += await blockAddressForUser(userId, email, 'bounced', b.diagnostic)
        } catch (e: any) {
          errors.push(`Bounce ${email}: ${e.message}`)
        }
      }
    }
  } catch (e: any) {
    errors.push(`Bounce scan failed: ${e.message}`)
  }

  // 2. Unsubscribe requests (subject line; reply bodies are checked in the reply sync)
  try {
    const ids = await listMessageIds(gmail, 'subject:(unsubscribe OR "remove me") newer_than:30d -in:sent', 100)
    const senders = new Set<string>()
    for (const id of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'] })
        .then(r => r.data).catch(() => null)
      if (!msg || msg.labelIds?.includes('SENT')) continue
      if (!isUnsubscribeIntent(header(msg, 'Subject') + ' ' + (msg.snippet || ''))) continue
      senders.add(extractAddress(header(msg, 'From')))
    }
    // Only block people we actually emailed, not every newsletter in the inbox
    const known = await findUserRecipients(userId, [...senders])
    const knownEmails = new Set(known.map(r => r.email.toLowerCase().trim()))
    for (const email of knownEmails) {
      try {
        await blockAddressForUser(userId, email, 'unsubscribed')
        unsubscribed++
      } catch (e: any) {
        errors.push(`Unsubscribe ${email}: ${e.message}`)
      }
    }
  } catch (e: any) {
    errors.push(`Unsubscribe scan failed: ${e.message}`)
  }

  return { bounced, unsubscribed, errors }
}
