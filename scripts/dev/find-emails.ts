/**
 * Finds confirmed work emails for people in data/contacts_missing_email.csv by asking
 * each company's mail server which candidate address exists (no email is sent).
 * Also finds recruiting inboxes (careers@, hr@, …) at the same companies.
 *
 *   npx tsx --env-file=.env.local scripts/dev/find-emails.ts [--limit-domains N]
 *
 * Results are cached in data/.smtp-cache.json, so re-runs continue where they stopped.
 * Output: data/contacts_found.csv (only server-confirmed addresses), ready for launch-campaign.ts.
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { PATTERNS, applyPattern, normalizeNamePart } from '../../lib/email/email-patterns'
import { candidateEmails, checkDomain, probeSession, ROLE_INBOXES, type DomainCheck } from '../../lib/email/smtp-finder'
import { classifyRole } from '../../lib/email/people-finder'

const CACHE = path.join('data', '.smtp-cache.json')
const MAX_RCPT_PER_SESSION = 12
const DOMAIN_CONCURRENCY = 2
const PAUSE_MS = 4000

type Verdict = 'safe' | 'invalid' | 'unknown'
interface Cache {
  domains: Record<string, DomainCheck>
  emails: Record<string, Verdict>
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

const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function nameParts(name: string): { first: string; last: string } | null {
  const words = name
    .replace(/\b(dr|mr|mrs|ms|prof|ca|er)\.?\s+/gi, '')
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}.'-]/gu, ''))
    .filter((w) => normalizeNamePart(w).length > 0)
  if (!words.length || normalizeNamePart(words[0]).length < 2) return null
  return { first: words[0], last: words.length > 1 ? words[words.length - 1] : '' }
}

/** Which pattern produced an earlier guess, so it is tried first. */
function patternOf(guess: string, first: string, last: string): string | null {
  const local = guess.split('@')[0]
  return PATTERNS.find((p) => applyPattern(p, first, last) === local) || null
}

async function main() {
  const args = process.argv.slice(2)
  const limit = args.includes('--limit-domains') ? Number(args[args.indexOf('--limit-domains') + 1]) : Infinity

  const cache: Cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { domains: {}, emails: {} }
  const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache))

  const people = parseCsv(fs.readFileSync('data/contacts_missing_email.csv', 'utf8')).filter((p) => p.company_domain && p.name)
  const byDomain = new Map<string, Record<string, string>[]>()
  for (const p of people) {
    const d = p.company_domain.toLowerCase().replace(/^www\./, '')
    byDomain.set(d, [...(byDomain.get(d) || []), p])
  }
  const domains = [...byDomain.keys()].slice(0, limit)
  console.log(`${people.length} people at ${domains.length} companies`)

  // 1. Which domains answer honestly?
  let checked = 0
  // 'unreachable' is often a temporary rate limit, so those are checked again
  const queue = domains.filter((d) => !cache.domains[d] || cache.domains[d].kind === 'unreachable')
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const d = queue.shift()!
      cache.domains[d] = await checkDomain(d)
      if (++checked % 50 === 0) { save(); console.log(`  domains checked ${checked}/${domains.length}`) }
    }
  }))
  save()
  const kinds = new Map<string, number>()
  for (const d of domains) kinds.set(cache.domains[d].kind, (kinds.get(cache.domains[d].kind) || 0) + 1)
  console.log('Domains:', Object.fromEntries(kinds))

  // 2. Probe candidates on probeable domains, one session per batch
  const probeable = domains.filter((d) => cache.domains[d].kind === 'probeable')
  let doneDomains = 0
  const found: Record<string, string>[] = []

  let throttledInARow = 0
  let stopped = false
  async function ask(mx: string, emails: string[]): Promise<void> {
    let todo = emails.filter((e) => !cache.emails[e])
    for (let attempt = 0; todo.length && attempt < 3 && !stopped; attempt++) {
      for (let i = 0; i < todo.length && !stopped; i += MAX_RCPT_PER_SESSION) {
        const batch = todo.slice(i, i + MAX_RCPT_PER_SESSION)
        const { results, throttled } = await probeSession(mx, batch)
        // Only real verdicts are cached; "unknown" is retried on the next run
        for (const [e, r] of results) if (r.status !== 'unknown') cache.emails[e] = r.status as Verdict
        if (throttled) {
          if (++throttledInARow >= 3) {
            stopped = true
            console.log('Mail servers are rate-limiting this IP. Stopping; re-run in an hour to continue (progress is saved).')
          }
          await sleep(30_000)
        } else throttledInARow = 0
        await sleep(PAUSE_MS)
      }
      const before = todo.length
      todo = todo.filter((e) => !cache.emails[e])
      if (todo.length === before) break // the server stopped answering; leave the rest
    }
  }

  const dq = [...probeable]
  await Promise.all(Array.from({ length: DOMAIN_CONCURRENCY }, async () => {
    while (dq.length && !stopped) {
      const domain = dq.shift()!
      const { mx } = cache.domains[domain]
      const staff = byDomain.get(domain)!

      // Ask about every candidate for every person (cheap) and the recruiting inboxes in one go
      const plan = staff.map((p) => {
        const n = nameParts(p.name)
        if (!n) return { p, cands: [] as string[] }
        const cands = n.last
          ? candidateEmails(n.first, n.last, domain, p.best_guess ? patternOf(p.best_guess, n.first, n.last) : null)
          : [`${normalizeNamePart(n.first)}@${domain}`]
        return { p, cands }
      })
      const roleInboxes = ROLE_INBOXES.map((r) => `${r}@${domain}`)
      await ask(mx!, [...plan.flatMap((x) => x.cands), ...roleInboxes])

      for (const { p, cands } of plan) {
        const hit = cands.find((e) => cache.emails[e] === 'safe')
        if (!hit) continue
        const n = nameParts(p.name)!
        found.push({
          email: hit,
          name: p.name,
          first_name: n.first.charAt(0).toUpperCase() + n.first.slice(1).toLowerCase(),
          title: p.title,
          role: classifyRole(p.title || ''),
          company: p.company,
          company_domain: domain,
          email_source: 'smtp_confirmed',
        })
      }
      const inbox = roleInboxes.find((e) => cache.emails[e] === 'safe')
      if (inbox) {
        found.push({ email: inbox, name: '', first_name: '', title: 'Recruiting inbox', role: 'hr', company: staff[0].company, company_domain: domain, email_source: 'smtp_confirmed' })
      }
      if (++doneDomains % 20 === 0) { save(); console.log(`  companies searched ${doneDomains}/${probeable.length}, found ${found.length}`) }
    }
  }))
  save()

  // 3. Write results, excluding addresses already used in a campaign or blocked
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: used } = await admin.from('email_recipients').select('email')
  const { data: blocked } = await admin.from('blocked_emails').select('email')
  const skip = new Set([...(used || []), ...(blocked || [])].map((r: any) => r.email.toLowerCase()))
  const seen = new Set<string>()
  const fresh = found.filter((f) => !skip.has(f.email) && !seen.has(f.email) && seen.add(f.email))

  const cols = ['email', 'name', 'first_name', 'title', 'role', 'company', 'company_domain', 'email_source']
  fs.writeFileSync(path.join('data', 'contacts_found.csv'), [cols.join(','), ...fresh.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n')

  const roles = new Map<string, number>()
  for (const f of fresh) roles.set(f.role, (roles.get(f.role) || 0) + 1)
  console.log(`\nConfirmed ${found.length} addresses (${fresh.length} new) → data/contacts_found.csv`)
  console.log('By role:', Object.fromEntries(roles))
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
