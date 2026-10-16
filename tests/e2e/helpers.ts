import { APIRequestContext, Browser, BrowserContext, Page, expect } from '@playwright/test'
import crypto from 'crypto'
import { Pool } from 'pg'
import { APP_URL, PORTS, PUBLIC_BASE_URL, SUPABASE_URL } from './config'
import { adminUrl } from './stack/postgres'
import { DB_NAME } from './config'

let pool: Pool | null = null
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: adminUrl(DB_NAME), max: 3 })
  return pool
}
export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db().query(sql, params)
  return res.rows as T[]
}

export const GMAIL = `http://127.0.0.1:${PORTS.gmail}`
export const SITES = `http://127.0.0.1:${PORTS.sites}`
export const ANTHROPIC = `http://127.0.0.1:${PORTS.anthropic}`

export interface TestUser {
  id: string
  email: string
  password: string
  mailbox: string // mock Gmail access token == mailbox key
  gmailAddress: string
  context: BrowserContext
  page: Page
  api: APIRequestContext
}

async function gateway(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

/** Cookie the @supabase/ssr server client reads: sb-<first host label>-auth-token, base64url-encoded session. */
export function sessionCookie(session: unknown) {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0]
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }
}

/**
 * Signs up a fresh user through the auth gateway, logs the browser context in via the session cookie,
 * and (optionally) connects a mock Gmail mailbox + fast sending limits.
 */
export async function newUser(
  browser: Browser,
  opts: { gmail?: boolean; fastSending?: Partial<Record<string, unknown>> | false } = {}
): Promise<TestUser> {
  const email = `e2e-${crypto.randomBytes(4).toString('hex')}@example.org`
  const password = 'Correct-Horse-9'
  const session = await gateway('/auth/v1/signup', { email, password })
  const id = session.user.id as string
  const context = await browser.newContext({ baseURL: APP_URL })
  await context.addCookies([sessionCookie(session)])
  const page = await context.newPage()
  const mailbox = `tok-${id}`
  const gmailAddress = `sender.${id.slice(0, 8)}@gmail.com`

  if (opts.gmail !== false) {
    await q(
      `INSERT INTO gmail_credentials (user_id, access_token, refresh_token, token_expiry, email_address)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 years', $4)`,
      [id, mailbox, `refresh-${id}`, gmailAddress]
    )
    await resetMailbox(mailbox, gmailAddress)
  }
  if (opts.fastSending !== false) {
    await setSenderSettings(id, opts.fastSending || {})
  }
  return { id, email, password, mailbox, gmailAddress, context, page, api: context.request }
}

export async function setSenderSettings(userId: string, overrides: Record<string, unknown> = {}) {
  const settings: Record<string, unknown> = {
    daily_limit: 50,
    warmup_enabled: false,
    min_delay_seconds: 1,
    max_delay_seconds: 1,
    send_window_start: 0,
    send_window_end: 24,
    skip_weekends: false,
    timezone: 'UTC',
    max_bounce_rate: 50,
    next_send_at: null,
    ...overrides,
  }
  const cols = Object.keys(settings)
  await q(
    `INSERT INTO sender_settings (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
    [userId, ...cols.map((c) => settings[c])]
  )
}

// ---------------- mock Gmail control ----------------
export async function resetMailbox(mailbox: string, email: string) {
  await fetch(`${GMAIL}/__control/reset?mailbox=${encodeURIComponent(mailbox)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}
export async function inject(mailbox: string, messages: Record<string, unknown>[]) {
  const res = await fetch(`${GMAIL}/__control/inject?mailbox=${encodeURIComponent(mailbox)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  return (await res.json()).messages as MockMessage[]
}
export interface MockMessage {
  id: string
  threadId: string
  labels: string[]
  from: string
  to: string
  subject: string
  messageId: string
  inReplyTo: string
  references: string
  listUnsubscribe: string
  text: string
  html: string
  internalDate: number
  hasAttachment: boolean
}
export async function mailboxMessages(mailbox: string, label?: string): Promise<MockMessage[]> {
  const res = await fetch(`${GMAIL}/__control/messages?mailbox=${encodeURIComponent(mailbox)}${label ? `&label=${label}` : ''}`)
  return (await res.json()).messages
}
export const sentMessages = (mailbox: string) => mailboxMessages(mailbox, 'SENT')

// ---------------- app data helpers ----------------
export async function createCampaign(
  user: TestUser,
  fields: { name?: string; subject_template?: string; email_body_template?: string; [k: string]: unknown } = {}
) {
  const res = await user.api.post('/api/campaigns', {
    data: {
      name: fields.name || 'E2E campaign',
      subject: fields.subject_template || 'Backend role at {{company}}',
      body:
        fields.email_body_template ||
        'Hi {{first_name}},\n\nI am a backend engineer and would love to contribute to {{company}}.\n\nWould you be open to a quick chat?\n\nThanks,\nUday',
      ...(typeof fields.resume_storage_path === 'string' ? { resume_storage_path: fields.resume_storage_path } : {}),
    },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const body = await res.json()
  const campaign = body.campaign || body
  // Extra columns the create route may not accept
  const extras = Object.fromEntries(Object.entries(fields).filter(([k]) => !['name', 'subject_template', 'email_body_template'].includes(k)))
  if (Object.keys(extras).length) {
    const cols = Object.keys(extras)
    await q(`UPDATE campaigns SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [campaign.id, ...cols.map((c) => extras[c])])
  }
  return campaign as { id: string; [k: string]: any }
}

export async function addRecipients(user: TestUser, campaignId: string, recipients: Record<string, unknown>[]) {
  const res = await user.api.post(`/api/campaigns/${campaignId}/recipients`, { data: { recipients } })
  expect(res.ok(), await res.text()).toBeTruthy()
  return res.json()
}

/** Calls the send endpoint until nothing is pending or the server reports a stop reason. */
export async function drainSend(user: TestUser, campaignId: string, maxCalls = 15) {
  const results: any[] = []
  for (let i = 0; i < maxCalls; i++) {
    const res = await user.api.post(`/api/campaigns/${campaignId}/send`, { data: { sendImmediately: true } })
    const body = await res.json()
    results.push(body)
    if (!res.ok()) break
    if (['done', 'daily_limit', 'outside_window', 'bounce_rate', 'auth', 'gmail_limit'].includes(body.reason) || body.stopped) break
    if (!body.remaining) break
    const wait = body.nextSendAt ? Math.max(0, new Date(body.nextSendAt).getTime() - Date.now()) + 200 : 1200
    await new Promise((r) => setTimeout(r, Math.min(wait, 5000)))
  }
  return results
}

/** Turns a link generated with the public base URL into one the test can reach. */
export function localUrl(publicUrl: string) {
  return publicUrl.replace(PUBLIC_BASE_URL, APP_URL)
}

export async function cron(api: APIRequestContext, secret?: string) {
  return api.get('/api/cron', { headers: secret ? { authorization: `Bearer ${secret}` } : {} })
}
