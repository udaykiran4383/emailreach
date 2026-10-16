/**
 * Finds everyone who replied to conversations you started (past internship /
 * job outreach) and writes them to data/past_replies.csv so you can follow up.
 * Read-only: nothing in Gmail is changed.
 *
 *   npx tsx --env-file=.env.local scripts/dev/past-replies.ts [--since 2022/01/01]
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { getGmailForUser, mapWithConcurrency, parseFromHeader } from '../../lib/gmail/cleanup'
import { classifyReplyByRules } from '../../lib/ai/classify-reply'

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|calendar|bounce|auto)/i
const AUTOMATED_DOMAIN = /(googlemail\.com|google\.com|calendar|workday|myworkday|greenhouse|lever\.co|ashbyhq|smartrecruiters|jobs2web|icims|taleo)/i
const AUTOMATED_SUBJECT = /(automatic reply|auto(-|\s)?reply|out of (the )?office|delivery status notification|undeliverable|mail delivery|accepted:|declined:|invitation:)/i

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.code || err?.response?.status
      if (attempt < 8 && (status === 429 || status >= 500 || (status === 403 && /quota|rate/i.test(err?.message || '')))) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt) + Math.random() * 1000))
        continue
      }
      throw err
    }
  }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const FREE_DOMAINS = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|proton|protonmail|rediffmail|aol)\./i

async function main() {
  const args = process.argv.slice(2)
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '2020/01/01'

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await admin.from('gmail_credentials').select('user_id')
  if (!data?.length) throw new Error('No Gmail account connected')
  const ctx = await getGmailForUser(process.env.CLEANUP_USER_ID || data[0].user_id)
  const me = ctx.email.toLowerCase()

  // 1. Threads that contain something you sent
  const threadIds = new Set<string>()
  let pageToken: string | undefined
  do {
    const res: any = await withRetry(() => ctx.gmail.users.threads.list({ userId: 'me', q: `in:sent after:${since}`, maxResults: 500, pageToken }))
    for (const t of res.data.threads || []) threadIds.add(t.id)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  console.log(`Conversations you sent in since ${since}: ${threadIds.size}`)

  // Per-thread results are cached so re-runs only fetch conversations not seen before
  const cachePath = path.join('data', '.past-replies-cache.json')
  const cache: Record<string, any> = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {}
  const ownDomains = new Set([me.split('@')[1], ...(process.env.OWN_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)])

  // 2. Keep threads you started where someone else (a person) answered
  type Reply = { email: string; name: string; company: string; first_contact: string; replied_at: string; subject: string; category: string; snippet: string; messages: number; thread: string }
  const replies: Reply[] = []
  let done = 0
  const todo = [...threadIds].filter((id) => !(id in cache))
  for (const id of threadIds) if (cache[id]) replies.push(cache[id])
  console.log(`Already checked: ${threadIds.size - todo.length}, to check: ${todo.length}`)
  const { truncated } = await mapWithConcurrency(todo, 6, Date.now() + 4 * 60 * 60_000, async (id: string) => {
    const t: any = await withRetry(() => ctx.gmail.users.threads.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }))
    const msgs: any[] = t.data.messages || []
    cache[id] = null
    if (++done % 200 === 0) {
      fs.writeFileSync(cachePath, JSON.stringify(cache))
      console.log(`  checked ${done}/${todo.length}`)
    }
    if (msgs.length < 2) return
    const header = (m: any, name: string) => m.payload?.headers?.find((h: any) => h.name === name)?.value || ''
    const first = parseFromHeader(header(msgs[0], 'From'))
    if (first.email !== me) return // only conversations you started

    const theirs = msgs.filter((m) => {
      const from = parseFromHeader(header(m, 'From'))
      if (!from.email || from.email === me) return false
      const [local, domain = ''] = from.email.split('@')
      if (ownDomains.has(domain)) return false
      return !AUTOMATED_SENDER.test(local) && !AUTOMATED_DOMAIN.test(domain) && !AUTOMATED_SUBJECT.test(header(m, 'Subject'))
    })
    if (theirs.length === 0) return

    const last = theirs[theirs.length - 1]
    const from = parseFromHeader(header(last, 'From'))
    const domain = from.email.split('@')[1] || ''
    const subject = header(msgs[0], 'Subject')
    const snippet = (last.snippet || '').replace(/\s+/g, ' ').trim()
    const reply: Reply = {
      email: from.email,
      name: from.name,
      company: FREE_DOMAINS.test(domain) ? '' : domain.split('.').slice(-2, -1)[0] || domain,
      first_contact: new Date(Number(msgs[0].internalDate)).toISOString().slice(0, 10),
      replied_at: new Date(Number(last.internalDate)).toISOString().slice(0, 10),
      subject,
      category: classifyReplyByRules(snippet, header(last, 'Subject')).category,
      snippet: snippet.slice(0, 200),
      messages: msgs.length,
      thread: `https://mail.google.com/mail/u/0/#all/${id}`,
    }
    cache[id] = reply
    replies.push(reply)
  })
  fs.writeFileSync(cachePath, JSON.stringify(cache))
  if (truncated) console.log('Warning: time limit reached — re-run to continue (progress is cached)')

  // 3. One row per person (latest reply wins)
  const byEmail = new Map<string, Reply>()
  for (const r of replies.sort((a, b) => a.replied_at.localeCompare(b.replied_at))) byEmail.set(r.email, r)
  const rows = [...byEmail.values()].sort((a, b) => b.replied_at.localeCompare(a.replied_at))

  const out = path.join('data', 'past_replies.csv')
  fs.mkdirSync('data', { recursive: true })
  const cols: (keyof Reply)[] = ['email', 'name', 'company', 'category', 'replied_at', 'first_contact', 'subject', 'snippet', 'messages', 'thread']
  fs.writeFileSync(out, [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n')

  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.category, (counts.get(r.category) || 0) + 1)
  console.log(`\nPeople who replied to you: ${rows.length}  →  ${out}`)
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${c}`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
