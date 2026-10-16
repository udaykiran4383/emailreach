/**
 * Finds new companies and confirmed contacts from public sources:
 *   1. Companies from the open YC directory (yc-oss.github.io): active Indian startups,
 *      plus remote-friendly AI / B2B startups that are hiring
 *   2. Founders, CTOs, engineering leads and HR from each company's own website
 *   3. Each address confirmed with the company's mail server (no email is sent);
 *      recruiting inboxes (careers@, jobs@ …) are checked too
 *
 *   curl -sL https://yc-oss.github.io/api/companies/all.json -o /tmp/yc.json
 *   npx tsx --env-file=.env.local scripts/dev/discover-contacts.ts /tmp/yc.json [--limit N] [--wide]
 *
 * --wide adds every hiring AI / B2B startup (≤300 people) in any region, after the default pool.
 *
 * Output: data/contacts_discovered.csv (only server-confirmed or published addresses).
 * Progress is cached (data/.discover-cache.json, data/.smtp-cache.json), so re-runs continue.
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { findCompanyContacts, type Contact } from '../../lib/email/people-finder'
import { candidateEmails, checkDomain, probeSession, ROLE_INBOXES, type DomainCheck } from '../../lib/email/smtp-finder'

const DISCOVER_CACHE = path.join('data', '.discover-cache.json')
const SMTP_CACHE = path.join('data', '.smtp-cache.json')
const MAX_RCPT_PER_SESSION = 12
const PAUSE_MS = 4000
const PER_COMPANY_MS = 30_000

interface YcCompany {
  name: string
  slug?: string
  website: string
  status: string
  isHiring: boolean
  regions?: string[]
  all_locations?: string
  tags?: string[]
  team_size?: number
  one_liner?: string
}

const AI_TAGS = new Set(['Artificial Intelligence', 'AI', 'Generative AI', 'Machine Learning', 'AI Assistant', 'Developer Tools', 'B2B', 'SaaS', 'Infrastructure'])
const KEEP_ROLES = new Set(['ceo', 'cto', 'tech_lead', 'hr'])

let lastYcFetch = 0
/** Founders listed on the company's public YC page (robots.txt allows /companies/<slug>). */
async function ycFounders(slug: string | undefined): Promise<{ name: string; title: string }[]> {
  if (!slug) return []
  const wait = lastYcFetch + 1500 - Date.now()
  lastYcFetch = Date.now() + Math.max(0, wait)
  if (wait > 0) await sleep(wait)
  try {
    const res = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (EmailReach contact research)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const m = (await res.text()).match(/data-page="([^"]+)"/)
    if (!m) return []
    const json = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    return (json?.props?.company?.founders || [])
      .filter((f: any) => f?.full_name && f.is_active !== false)
      .map((f: any) => ({ name: String(f.full_name).trim(), title: String(f.title || 'Founder').trim() }))
  } catch {
    return []
  }
}

function splitFull(name: string): { first: string; last: string } {
  const words = name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean)
  return { first: words[0] || '', last: words.length > 1 ? words[words.length - 1] : '' }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const domainOf = (url: string) => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function pickCompanies(all: YcCompany[], wide: boolean): YcCompany[] {
  const active = all.filter((c) => c.status === 'Active' && c.website)
  const india = active.filter((c) => (c.regions || []).some((r) => /India/.test(r)) || /India/.test(c.all_locations || ''))
  const remoteAi = active.filter(
    (c) => c.isHiring && (c.regions || []).includes('Remote') && (c.tags || []).some((t) => AI_TAGS.has(t)) && (c.team_size || 0) <= 200
  )
  const anywhereAi = wide
    ? active.filter((c) => c.isHiring && (c.tags || []).some((t) => AI_TAGS.has(t)) && (c.team_size || 0) <= 300)
    : []
  // Indian companies first: they're the likeliest to hire you
  const seen = new Set<string>()
  return [...india.sort((a, b) => Number(b.isHiring) - Number(a.isHiring)), ...remoteAi, ...anywhereAi].filter((c) => {
    const d = domainOf(c.website)
    if (!d || seen.has(d)) return false
    seen.add(d)
    return true
  })
}

async function main() {
  const args = process.argv.slice(2)
  const src = args[0]
  if (!src || !fs.existsSync(src)) throw new Error('Pass the path to the downloaded yc-oss all.json')
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: used } = await admin.from('email_recipients').select('email')
  const { data: blocked } = await admin.from('blocked_emails').select('email')
  const skipEmails = new Set([...(used || []), ...(blocked || [])].map((r: any) => r.email.toLowerCase()))
  const contactedDomains = new Set([...skipEmails].map((e) => e.split('@')[1]))

  const companies = pickCompanies(JSON.parse(fs.readFileSync(src, 'utf8')), args.includes('--wide'))
    .filter((c) => !contactedDomains.has(domainOf(c.website)))
    .slice(0, limit)
  console.log(`${companies.length} companies to search`)

  type Found = Record<string, string>
  const discover: Record<string, Found[] | null> = fs.existsSync(DISCOVER_CACHE) ? JSON.parse(fs.readFileSync(DISCOVER_CACHE, 'utf8')) : {}
  const smtp: { domains: Record<string, DomainCheck>; emails: Record<string, string> } =
    fs.existsSync(SMTP_CACHE) ? JSON.parse(fs.readFileSync(SMTP_CACHE, 'utf8')) : { domains: {}, emails: {} }
  const save = () => {
    fs.writeFileSync(DISCOVER_CACHE, JSON.stringify(discover))
    fs.writeFileSync(SMTP_CACHE, JSON.stringify(smtp))
  }

  let throttledInARow = 0
  let stopped = false
  async function ask(mx: string, emails: string[]) {
    const todo = emails.filter((e) => !smtp.emails[e])
    for (let i = 0; i < todo.length && !stopped; i += MAX_RCPT_PER_SESSION) {
      const { results, throttled } = await probeSession(mx, todo.slice(i, i + MAX_RCPT_PER_SESSION))
      for (const [e, r] of results) if (r.status !== 'unknown') smtp.emails[e] = r.status
      if (throttled) {
        if (++throttledInARow >= 3) {
          stopped = true
          console.log('Mail servers are rate-limiting this IP. Stopping; re-run later to continue (progress is saved).')
        }
        await sleep(30_000)
      } else throttledInARow = 0
      await sleep(PAUSE_MS)
    }
  }

  let done = 0
  const queue = companies.filter((c) => !discover[domainOf(c.website)])
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length && !stopped) {
      const c = queue.shift()!
      const domain = domainOf(c.website)
      const out: Found[] = []
      try {
        // People (names + titles) and any addresses published on the company's own site
        const { contacts } = await findCompanyContacts(c.website, {
          roles: [],
          verify: false,
          guessPatterns: true,
          deadline: Date.now() + PER_COMPANY_MS,
        })
        const people = contacts.filter((p: Contact) => KEEP_ROLES.has(p.role) || /founder/i.test(p.title))
        // Founders from YC, unless the website already gave us that person
        for (const f of await ycFounders(c.slug)) {
          const { first, last } = splitFull(f.name)
          if (!first || people.some((p) => p.name.toLowerCase() === f.name.toLowerCase())) continue
          people.push({
            email: `${first.toLowerCase()}@${domain}`, name: f.name, firstName: first, lastName: last, title: f.title,
            role: /cto|technolog/i.test(f.title) ? 'cto' : 'ceo', company: c.name, domain, source: 'pattern', confidence: 50,
          })
        }

        smtp.domains[domain] ||= await checkDomain(domain)
        const { kind, mx } = smtp.domains[domain]

        if (kind === 'probeable') {
          const plans = people.map((p) => ({
            p,
            cands: p.source === 'website' ? [p.email.toLowerCase()] : p.lastName ? candidateEmails(p.firstName, p.lastName, domain) : [p.email.toLowerCase()],
          }))
          const inboxes = ROLE_INBOXES.map((r) => `${r}@${domain}`)
          await ask(mx!, [...plans.flatMap((x) => x.cands), ...inboxes])
          for (const { p, cands } of plans) {
            const hit = cands.find((e) => smtp.emails[e] === 'safe')
            if (hit) out.push({ email: hit, name: p.name, first_name: p.firstName, title: p.title, role: p.role, company: c.name, company_domain: domain, email_source: 'smtp_confirmed' })
          }
          const inbox = inboxes.find((e) => smtp.emails[e] === 'safe')
          if (inbox) out.push({ email: inbox, name: '', first_name: '', title: 'Recruiting inbox', role: 'hr', company: c.name, company_domain: domain, email_source: 'smtp_confirmed' })
        } else {
          // Can't confirm with the server: only keep addresses the company itself publishes
          for (const p of people.filter((p) => p.source === 'website')) {
            out.push({ email: p.email.toLowerCase(), name: p.name, first_name: p.firstName, title: p.title, role: p.role, company: c.name, company_domain: domain, email_source: 'published_on_website' })
          }
        }
        if (!stopped) discover[domain] = out
      } catch (err) {
        console.warn(`  ${domain}: ${err instanceof Error ? err.message : err}`)
        discover[domain] = []
      }
      if (++done % 10 === 0) {
        save()
        const total = Object.values(discover).reduce((n, v) => n + (v?.length || 0), 0)
        console.log(`  searched ${done}/${companies.length} companies, ${total} contacts so far`)
      }
    }
  }))
  save()

  // Everything found so far (this and earlier runs), minus anyone already emailed
  const seen = new Set<string>()
  const rows = Object.values(discover)
    .flatMap((v) => v || [])
    .filter((r) => !skipEmails.has(r.email) && !seen.has(r.email) && seen.add(r.email))
  const cols = ['email', 'name', 'first_name', 'title', 'role', 'company', 'company_domain', 'email_source']
  fs.writeFileSync(path.join('data', 'contacts_discovered.csv'), [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n')
  const roles = new Map<string, number>()
  for (const r of rows) roles.set(r.role, (roles.get(r.role) || 0) + 1)
  console.log(`\n${rows.length} new contacts → data/contacts_discovered.csv`, Object.fromEntries(roles))
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
