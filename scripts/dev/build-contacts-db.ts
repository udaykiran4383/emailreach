/**
 * Builds one clean contacts database from every source the project has, with one row per
 * email address, a verification level you can trust, and where each contact stands in outreach.
 *
 * Sources: data/contacts_all.csv (Google Sheet), data/contacts_missing_email.csv + the mail-server
 * check cache (confirmed addresses for sheet people), data/contacts_discovered.csv (YC startups),
 * data/past_replies.csv, and live campaign / bounce data from Supabase.
 *
 *   npx tsx --env-file=.env.local scripts/dev/build-contacts-db.ts
 *
 * Output: data/contacts_db.csv  (sendable contacts first)
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { classifyRole } from '../../lib/email/people-finder'
import { candidateEmails } from '../../lib/email/smtp-finder'
import { normalizeNamePart } from '../../lib/email/email-patterns'

// Verification levels, strongest first. Only the first five are sent to.
const LEVELS = [
  'replied',        // they wrote back from this address
  'confirmed',      // their mail server confirmed the mailbox exists
  'delivered',      // we emailed it and it did not bounce
  'published',      // listed on the company's own website
  'listed',         // given in your sheet; domain accepts mail, mailbox not checked
  'catch_all',      // pattern guess on a domain that accepts any address: can't confirm
  'unverified',     // pattern guess, mail server would not answer
  'invalid',        // mail server says the mailbox does not exist
  'bounced',        // we emailed it and it bounced, or it is on the block list
] as const
type Level = (typeof LEVELS)[number]
const SENDABLE = new Set<Level>(['replied', 'confirmed', 'delivered', 'published', 'listed'])

interface Row {
  email: string
  verification: Level
  sendable: string
  name: string
  first_name: string
  title: string
  role: string
  company: string
  domain: string
  linkedin: string
  source: string
  outreach: string
  campaign: string
  last_sent: string
  reply_category: string
  reply_note: string
}

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
const readCsv = (f: string) => (fs.existsSync(f) ? parseCsv(fs.readFileSync(f, 'utf8')) : [])
const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const clean = (s: string | undefined) => (s || '').replace(/\s+/g, ' ').trim()
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)

function roleOf(title: string): string {
  if (/recruiting inbox/i.test(title)) return 'hr'
  const r = classifyRole(title || '')
  if (r !== 'other') return r
  return /founder/i.test(title) ? 'ceo' : 'other'
}

function nameParts(name: string): { first: string; last: string } | null {
  const words = name.replace(/\(.*?\)/g, '').split(/\s+/).map((w) => w.replace(/[^\p{L}.'-]/gu, '')).filter((w) => normalizeNamePart(w))
  if (!words.length || normalizeNamePart(words[0]).length < 2) return null
  return { first: words[0], last: words.length > 1 ? words[words.length - 1] : '' }
}

async function main() {
  const db = new Map<string, Row>()
  const smtp: { domains: Record<string, { kind: string }>; emails: Record<string, string> } =
    fs.existsSync('data/.smtp-cache.json') ? JSON.parse(fs.readFileSync('data/.smtp-cache.json', 'utf8')) : { domains: {}, emails: {} }

  /** Adds or merges a contact; the stronger verification level and any missing fields win. */
  function upsert(email: string, level: Level, fields: Partial<Row>) {
    email = email.trim().toLowerCase()
    if (!isEmail(email)) return
    // A mail-server verdict overrides weaker evidence
    const verdict = smtp.emails[email]
    if (verdict === 'safe' && LEVELS.indexOf(level) > LEVELS.indexOf('confirmed')) level = 'confirmed'
    if (verdict === 'invalid' && !['replied', 'delivered', 'bounced'].includes(level)) level = 'invalid'

    const cur = db.get(email)
    const domain = email.split('@')[1]
    if (!cur) {
      db.set(email, {
        email, verification: level, sendable: '', name: '', first_name: '', title: '', role: '', company: '', domain,
        linkedin: '', source: '', outreach: 'not_contacted', campaign: '', last_sent: '', reply_category: '', reply_note: '',
        ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, clean(String(v ?? ''))])),
      } as Row)
      return
    }
    // bounced/invalid are hard facts and win over everything except a real reply
    const hard = (l: Level) => l === 'bounced' || l === 'invalid'
    if (level === 'replied' || (hard(level) && cur.verification !== 'replied') || (!hard(cur.verification) && LEVELS.indexOf(level) < LEVELS.indexOf(cur.verification))) {
      cur.verification = level
    }
    for (const [k, v] of Object.entries(fields) as [keyof Row, string][]) {
      if (k === 'source') {
        const parts = new Set([...cur.source.split(' + ').filter(Boolean), ...clean(v).split(' + ').filter(Boolean)])
        cur.source = [...parts].join(' + ')
      } else if (v && !cur[k]) (cur as any)[k] = clean(v)
    }
  }

  // 1. Google Sheet (all tabs)
  for (const r of readCsv('data/contacts_all.csv')) {
    const src = r.email_source
    const v = (r.verification_status || '').toLowerCase()
    const level: Level =
      v === 'invalid' ? 'invalid'
      : src === 'website' ? 'published'
      : src === 'pattern_guess' ? (smtp.domains[(r.company_domain || r.email.split('@')[1]).toLowerCase()]?.kind === 'catch_all' ? 'catch_all' : 'unverified')
      : 'listed'
    upsert(r.email, level, {
      name: r.name, first_name: r.first_name, title: r.title, company: r.company, linkedin: r.linkedin,
      source: src === 'pattern_guess' ? 'sheet (guessed)' : src === 'website' ? 'company website' : 'sheet',
    })
  }

  // 2. Sheet people whose real address the mail-server check found
  let recovered = 0
  for (const p of readCsv('data/contacts_missing_email.csv')) {
    const domain = (p.company_domain || '').toLowerCase().replace(/^www\./, '')
    const n = domain && p.name ? nameParts(p.name) : null
    if (!n) continue
    const cands = n.last ? candidateEmails(n.first, n.last, domain) : [`${normalizeNamePart(n.first)}@${domain}`]
    const hit = cands.find((e) => smtp.emails[e] === 'safe')
    if (!hit) continue
    recovered++
    upsert(hit, 'confirmed', { name: p.name, first_name: n.first, title: p.title, company: p.company, linkedin: p.linkedin, source: 'sheet + mail-server check' })
    // The earlier unconfirmed guess for this person is now redundant
    if (p.best_guess && p.best_guess.toLowerCase() !== hit && db.get(p.best_guess.toLowerCase())?.verification !== 'replied') {
      const g = db.get(p.best_guess.toLowerCase())
      if (g && (g.verification === 'unverified' || g.verification === 'catch_all' || g.verification === 'invalid')) db.delete(g.email)
    }
  }
  // Recruiting inboxes found at sheet companies
  for (const [e, v] of Object.entries(smtp.emails)) {
    const local = e.split('@')[0]
    if (v === 'safe' && /^(careers|hr|jobs|hiring|talent|recruitment|people)$/.test(local)) {
      upsert(e, 'confirmed', { title: 'Recruiting inbox', source: 'mail-server check' })
    }
  }

  // 3. YC startups
  for (const r of readCsv('data/contacts_discovered.csv')) {
    upsert(r.email, r.email_source === 'smtp_confirmed' ? 'confirmed' : 'published', {
      name: r.name, first_name: r.first_name, title: r.title, company: r.company, source: 'YC directory + company site',
    })
  }

  // 4. People who replied to your past outreach
  for (const r of readCsv('data/past_replies.csv')) {
    upsert(r.email, 'replied', { name: r.name, company: r.company, reply_category: r.category, reply_note: r.ai_reason || r.snippet, source: 'past Gmail replies' })
  }

  // 5. Live outreach state from the app
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const recipients: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('email_recipients')
      .select('email, name, company, status, sent_at, replied_at, reply_snippet, error_message, variables, campaigns!inner(name)')
      .range(from, from + 999)
    if (error) throw error
    recipients.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  for (const r of recipients) {
    const status: string = r.status
    const level: Level = r.replied_at ? 'replied' : status === 'bounced' ? 'bounced' : status === 'sent' ? 'delivered' : 'listed'
    upsert(r.email, level, { name: r.name === 'there' ? '' : r.name, company: r.company, title: r.variables?.title, source: 'campaign' })
    const row = db.get(r.email.toLowerCase())
    if (!row) continue
    const outreach = r.replied_at ? 'replied' : status === 'pending' ? 'queued' : status
    // Keep the most advanced state if someone is in more than one campaign
    const rank = ['not_contacted', 'queued', 'skipped', 'failed', 'sent', 'bounced', 'replied']
    if (rank.indexOf(outreach) >= rank.indexOf(row.outreach)) {
      row.outreach = outreach
      row.campaign = r.campaigns?.name || row.campaign
      row.last_sent = r.sent_at ? r.sent_at.slice(0, 10) : row.last_sent
      if (r.reply_snippet) row.reply_note = clean(r.reply_snippet).slice(0, 200)
    }
  }
  const { data: blocked } = await admin.from('blocked_emails').select('email')
  for (const b of blocked || []) {
    const row = db.get(b.email.toLowerCase())
    if (row && row.verification !== 'replied') row.verification = 'bounced'
  }

  // 6. Finish: roles, names, sort, write
  for (const r of db.values()) {
    if (r.title === 'other' || r.title === 'referral') r.title = ''
    r.role = roleOf(r.title)
    if (!r.first_name && r.name) r.first_name = r.name.split(' ')[0]
    if (!r.company) r.company = r.domain.split('.')[0]
    // A working address isn't enough: don't re-pitch people who said no or asked not to be emailed
    const saidNo = /^(rejection|not_hiring|unsubscribe|auto_reply_other)$/.test(r.reply_category)
    r.sendable = SENDABLE.has(r.verification) && r.outreach !== 'bounced' && !saidNo ? 'yes' : 'no'
  }
  const roleRank = ['ceo', 'cto', 'tech_lead', 'hr', 'other']
  const rows = [...db.values()].sort(
    (a, b) =>
      Number(b.sendable === 'yes') - Number(a.sendable === 'yes') ||
      LEVELS.indexOf(a.verification) - LEVELS.indexOf(b.verification) ||
      roleRank.indexOf(a.role) - roleRank.indexOf(b.role) ||
      a.company.localeCompare(b.company)
  )
  const cols: (keyof Row)[] = ['email', 'sendable', 'verification', 'name', 'first_name', 'title', 'role', 'company', 'domain', 'linkedin', 'source', 'outreach', 'campaign', 'last_sent', 'reply_category', 'reply_note']
  const out = path.join('data', 'contacts_db.csv')
  fs.writeFileSync(out, [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n')

  const count = (f: (r: Row) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(f(r), (m.get(f(r)) || 0) + 1)
    return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))
  }
  console.log(`${rows.length} unique emails → ${out}  (recovered ${recovered} confirmed addresses for sheet people)`)
  console.log('sendable:', count((r) => r.sendable))
  console.log('verification:', count((r) => r.verification))
  console.log('role (sendable):', Object.fromEntries(Object.entries(count((r) => (r.sendable === 'yes' ? r.role : '-'))).filter(([k]) => k !== '-')))
  console.log('outreach:', count((r) => r.outreach))
  console.log('sendable & not yet contacted:', rows.filter((r) => r.sendable === 'yes' && r.outreach === 'not_contacted').length)
  console.log('companies:', new Set(rows.map((r) => r.domain)).size)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
