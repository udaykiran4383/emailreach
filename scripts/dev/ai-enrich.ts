/**
 * Uses Claude (ANTHROPIC_API_KEY) on data you already have:
 *   replies  — re-reads each past reply in full and re-classifies it with AI,
 *              rewriting data/past_replies.csv and data/past_replies_followup.csv
 *   openers  — writes a personalised first line as a DRAFT (opener_draft) for every pending
 *              recipient of campaigns whose template uses {{opener}}. Drafts are never sent
 *              until you approve them on the campaign's Personalize panel.
 *
 *   npx tsx --env-file=.env.local scripts/dev/ai-enrich.ts replies|openers|all
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { getGmailForUser, mapWithConcurrency } from '../../lib/gmail/cleanup'
import { extractMessageText } from '../../lib/email/bounces'
import { classifyReply } from '../../lib/ai/classify-reply'
import { isAiEnabled } from '../../lib/ai/client'
import { companyDomainFromEmail, generateOpener } from '../../lib/ai/personalize'
import { mergeRecipientVariables } from '../../lib/db/atomic'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Categories worth a fresh "are you hiring?" email
const NO_FOLLOWUP = new Set(['rejection', 'not_hiring', 'unsubscribe', 'auto_reply_other'])

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header, ...data] = rows
  return data.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (cols: string[], rows: Record<string, string>[]) =>
  [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.code || err?.status || err?.response?.status
      if (attempt < 6 && (status === 429 || status === 529 || status >= 500 || (status === 403 && /quota|rate/i.test(err?.message || '')))) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt) + Math.random() * 1000))
        continue
      }
      throw err
    }
  }
}

async function replies(userId: string) {
  const file = path.join('data', 'past_replies.csv')
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
  const ctx = await getGmailForUser(userId)
  const me = ctx.email.toLowerCase()
  console.log(`Re-classifying ${rows.length} past replies with AI…`)

  await mapWithConcurrency(rows, 4, Date.now() + 30 * 60_000, async (r) => {
    const threadId = r.thread.split('/').pop()!
    const t: any = await withRetry(() => ctx.gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' }))
    const msgs: any[] = t.data.messages || []
    const from = (m: any) => (m.payload?.headers?.find((h: any) => h.name === 'From')?.value || '').toLowerCase()
    const theirs = msgs.filter((m) => from(m).includes(r.email) && !from(m).includes(me))
    const last = theirs[theirs.length - 1] || msgs[msgs.length - 1]
    const text = extractMessageText(last.payload) || last.snippet || r.snippet
    const result = await classifyReply(text, r.subject, new Date(r.replied_at))
    r.category = result.category
    r.ai_reason = result.reason
  })

  const cols = ['email', 'name', 'company', 'category', 'ai_reason', 'replied_at', 'first_contact', 'subject', 'snippet', 'messages', 'thread']
  fs.writeFileSync(file, toCsv(cols, rows))
  const followup = rows.filter((r) => !NO_FOLLOWUP.has(r.category))
  fs.writeFileSync(path.join('data', 'past_replies_followup.csv'), toCsv(cols, followup))

  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.category, (counts.get(r.category) || 0) + 1)
  for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${c}`)
  console.log(`Worth following up: ${followup.length} → data/past_replies_followup.csv`)
  const hot = rows.filter((r) => ['interested', 'interview_request', 'send_resume', 'referral'].includes(r.category))
  for (const r of hot) console.log(`  ${r.category.padEnd(18)} ${r.email}  — ${r.ai_reason}`)
}

async function openers(userId: string) {
  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id, name, email_body_template, status')
    .eq('user_id', userId)
    .in('status', ['draft', 'scheduled', 'paused'])
  const targets = (campaigns || []).filter((c) => /\{\{\s*opener\s*\}\}/i.test(c.email_body_template || ''))

  for (const c of targets) {
    const { data: rows } = await admin
      .from('email_recipients')
      .select('id, email, name, company, variables')
      .eq('campaign_id', c.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    const todo = (rows || []).filter((r: any) => !r.variables?.opener_confidence && r.variables?.title !== 'Preview copy')
    console.log(`${c.name}: writing ${todo.length} opener drafts…`)
    const tally = { high: 0, medium: 0, low: 0, failed: 0 }
    let done = 0

    await mapWithConcurrency(todo, 4, Date.now() + 90 * 60_000, async (r: any) => {
      const vars = r.variables || {}
      try {
        const out = await withRetry(() =>
          generateOpener({
            name: r.name === 'there' ? null : r.name,
            title: typeof vars.title === 'string' ? vars.title : null,
            company: r.company,
            domain: companyDomainFromEmail(r.email) || (typeof vars.domain === 'string' ? vars.domain : null),
            jobTitle: 'AI / ML engineer (full-time)',
          })
        )
        await mergeRecipientVariables(r.id, {
          opener_draft: out.opener,
          opener_basis: out.basis,
          opener_confidence: out.confidence,
          opener_approved: false,
          opener: '',
        })
        tally[out.confidence]++
      } catch (err) {
        console.warn(`  ${r.email}: ${err instanceof Error ? err.message : err}`)
        await mergeRecipientVariables(r.id, { opener_draft: '', opener: '', opener_confidence: 'failed', opener_approved: false }).catch(() => {})
        tally.failed++
      }
      if (++done % 25 === 0) console.log(`  ${done}/${todo.length}`)
    })
    console.log(`  done — high ${tally.high}, medium ${tally.medium}, low ${tally.low}, failed ${tally.failed}`)
  }
}

async function main() {
  const mode = process.argv[2] || 'all'
  if (!isAiEnabled()) throw new Error('ANTHROPIC_API_KEY is not set')
  const { data } = await admin.from('gmail_credentials').select('user_id')
  if (!data?.length) throw new Error('No Gmail account connected')
  const userId = data[0].user_id
  if (mode === 'replies' || mode === 'all') await replies(userId)
  if (mode === 'openers' || mode === 'all') await openers(userId)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
