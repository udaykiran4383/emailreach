/**
 * Finds founders of US startups (Bay Area first) whose public YC bio mentions IIT Bombay,
 * then confirms each founder's work address with the company's mail server (no email is sent).
 * Only server-confirmed addresses are written; founders whose address can't be confirmed are
 * listed separately without an email.
 *
 *   curl -sL https://yc-oss.github.io/api/companies/all.json -o /tmp/yc.json
 *   npx tsx --env-file=.env.local scripts/dev/find-alumni-founders.ts /tmp/yc.json [--limit N]
 *
 * Output: data/contacts_iit_alumni.csv (confirmed) and data/iit_alumni_unconfirmed.csv.
 * Progress is cached (data/.alumni-cache.json, data/.smtp-cache.json), so re-runs continue.
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { candidateEmails, checkDomain, probeSession, type DomainCheck } from '../../lib/email/smtp-finder'

// Every active founder's public YC bio, so different school filters don't need re-reading pages
const ALUMNI_CACHE = path.join('data', '.yc-founders-cache.json')
const SMTP_CACHE = path.join('data', '.smtp-cache.json')
const MAX_RCPT_PER_SESSION = 12
const PAUSE_MS = 4000

const IITB_RE = /\bIIT[\s-]?Bombay\b|\bIIT[\s-]?B\b|\bIITB\b|Indian Institute of Technology[\s,(–-]*Bombay|\bIIT[\s-]?Mumbai\b/i
// Any IIT campus (word-boundary "IIT", or the full name)
const IIT_RE = /\bIIT(s|[\s-]?[A-Z][a-z]+|[A-Z]{1,3})?\b|Indian Institute of Technology/
const school = (bio: string) => /Illinois Inst|Illinois Tech/i.test(bio) && !/Indian Institute of Technology|IIT[\s-]?(Bombay|Delhi|Madras|Kanpur|Kharagpur|Roorkee|Guwahati)/i.test(bio) ? '' : (IITB_RE.test(bio) ? 'IIT Bombay' : IIT_RE.test(bio) ? (bio.match(/\bIIT[\s-]?[A-Z][a-z]+|Indian Institute of Technology[\s,(–-]*[A-Z][a-z]+/)?.[0] || 'IIT') : '')
const BAY_RE = /San Francisco|Palo Alto|Mountain View|San Jose|Menlo Park|Sunnyvale|Redwood City|Berkeley|Oakland|Santa Clara|San Mateo|Los Altos|Cupertino|Fremont|Los Gatos|Burlingame|Foster City|Milpitas|Saratoga|South San Francisco|Emeryville|Belmont|San Carlos|Campbell/

interface YcCompany { name: string; slug?: string; website: string; status: string; all_locations?: string; team_size?: number; isHiring?: boolean; batch?: string; tags?: string[] }
interface Alum { name: string; title: string; bio: string }

const AI_TAGS = /Artificial Intelligence|^AI$|Generative AI|Machine Learning|AI Assistant|Developer Tools|B2B|SaaS|Infrastructure/

/** How likely the company is to hand out freelance/contract work: small, young, hiring, AI/B2B. 0-100. */
function freelanceScore(c?: YcCompany): number {
  if (!c) return 50
  const size = c.team_size || 0
  const year = Number((c.batch || '').match(/\d{4}/)?.[0] || 0) || (Number((c.batch || '').match(/\d{2}$/)?.[0] || 0) + 2000)
  let s = 0
  s += size && size <= 10 ? 35 : size <= 30 ? 25 : size <= 100 ? 10 : 0
  s += year >= 2024 ? 30 : year >= 2021 ? 15 : 0
  s += c.isHiring ? 20 : 0
  s += (c.tags || []).some((t) => AI_TAGS.test(t)) ? 15 : 0
  return s
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const domainOf = (url: string) => {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
function splitFull(name: string): { first: string; last: string } {
  const words = name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean)
  return { first: words[0] || '', last: words.length > 1 ? words[words.length - 1] : '' }
}

/** Active founders on the company's public YC page, with their bios. null = page not read. */
async function ycFounders(slug: string): Promise<Alum[] | null> {
  try {
    const res = await fetch(`https://www.ycombinator.com/companies/${encodeURIComponent(slug)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (EmailReach contact research)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return []
    if (!res.ok) return null
    const m = (await res.text()).match(/data-page="([^"]+)"/)
    if (!m) return []
    const json = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    return (json?.props?.company?.founders || [])
      .filter((f: any) => f?.full_name && f.is_active !== false)
      .map((f: any) => ({ name: String(f.full_name).trim(), title: String(f.title || 'Founder').trim(), bio: String(f.founder_bio || '').replace(/\s+/g, ' ').trim() }))
  } catch {
    return null
  }
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

  const all: YcCompany[] = JSON.parse(fs.readFileSync(src, 'utf8'))
  const active = all.filter((c) => c.status === 'Active' && c.slug && c.website)
  const isUs = (c: YcCompany) => /USA/.test(c.all_locations || '')
  // Bay Area first, then the rest of the US, then everywhere else (unless --us-only)
  const companies = [
    ...active.filter((c) => isUs(c) && BAY_RE.test(c.all_locations || '')),
    ...active.filter((c) => isUs(c) && !BAY_RE.test(c.all_locations || '')),
    ...(args.includes('--us-only') ? [] : active.filter((c) => !isUs(c))),
  ].slice(0, limit)
  // --iitb: IIT Bombay only; default: any IIT (IIT Bombay listed first)
  const wanted = (bio: string) => (args.includes('--iitb') ? IITB_RE.test(bio) : !!school(bio))

  const cache: Record<string, Alum[]> = fs.existsSync(ALUMNI_CACHE) ? JSON.parse(fs.readFileSync(ALUMNI_CACHE, 'utf8')) : {}
  const smtp: { domains: Record<string, DomainCheck>; emails: Record<string, string> } =
    fs.existsSync(SMTP_CACHE) ? JSON.parse(fs.readFileSync(SMTP_CACHE, 'utf8')) : { domains: {}, emails: {} }
  const save = () => {
    fs.writeFileSync(ALUMNI_CACHE, JSON.stringify(cache))
    fs.writeFileSync(SMTP_CACHE, JSON.stringify(smtp))
  }

  // 1. Read founder bios (one YC page every 1.5 s)
  const todo = companies.filter((c) => !cache[c.slug!])
  console.log(`${companies.length} startups; reading ${todo.length} YC pages`)
  let read = 0
  for (const c of todo) {
    const found = await ycFounders(c.slug!)
    if (found) cache[c.slug!] = found
    const alums = (found || []).filter((f) => wanted(f.bio))
    if (alums.length) console.log(`  ${c.name}: ${alums.map((f) => `${f.name} (${school(f.bio)})`).join(', ')}`)
    if (++read % 50 === 0) {
      save()
      console.log(`  read ${read}/${todo.length}`)
    }
    await sleep(1500)
  }
  save()

  // 2. Confirm each alum's work address with the mail server
  const alumni = companies.flatMap((c) => (cache[c.slug!] || []).filter((f) => wanted(f.bio)).map((f) => ({ ...f, company: c.name, domain: domainOf(c.website), location: c.all_locations || '', yc: c as YcCompany | undefined })))
  // Alumni found elsewhere on the web (name,title,company,website,location,source), e.g. IIT Bombay's own alumni pages
  if (args.includes('--extra')) {
    const [header, ...lines] = fs.readFileSync(args[args.indexOf('--extra') + 1], 'utf8').trim().split('\n').map((l) => l.split(','))
    for (const cells of lines) {
      const r = Object.fromEntries(header.map((h, i) => [h, (cells[i] || '').trim()]))
      const domain = domainOf(r.website)
      if (!alumni.some((a) => a.name === r.name && a.domain === domain)) alumni.push({ name: r.name, title: r.title, bio: `Source: ${r.source}`, company: r.company, domain, location: r.location, yc: undefined })
    }
  }
  console.log(`\n${alumni.length} alumni founders found; confirming addresses`)
  let throttledInARow = 0
  let stopped = false
  const confirmed: Record<string, string>[] = []
  const unconfirmed: Record<string, string>[] = []
  for (const a of alumni) {
    const { first, last } = splitFull(a.name)
    let email = ''
    let why = ''
    if (!stopped && a.domain && first) {
      smtp.domains[a.domain] ||= await checkDomain(a.domain)
      const { kind, mx } = smtp.domains[a.domain]
      if (kind === 'probeable') {
        const cands = last ? candidateEmails(first, last, a.domain) : [`${first.toLowerCase()}@${a.domain}`]
        const ask = cands.filter((e) => !smtp.emails[e])
        for (let i = 0; i < ask.length && !stopped && !cands.some((e) => smtp.emails[e] === 'safe'); i += MAX_RCPT_PER_SESSION) {
          const { results, throttled } = await probeSession(mx!, ask.slice(i, i + MAX_RCPT_PER_SESSION))
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
        email = cands.find((e) => smtp.emails[e] === 'safe') || ''
        if (!email) why = 'no candidate address confirmed'
      } else why = kind === 'catch_all' ? 'server accepts any address (cannot confirm)' : `mail server: ${kind}`
    } else why = stopped ? 'rate-limited, re-run later' : 'no domain'
    const row = { email, name: a.name, first_name: first, title: a.title, role: /cto|technolog/i.test(a.title) ? 'cto' : 'ceo', company: a.company, company_domain: a.domain, location: a.location, email_source: 'smtp_confirmed', school: school(a.bio) || 'IIT Bombay', team_size: String(a.yc?.team_size ?? ''), batch: a.yc?.batch || '', hiring: a.yc?.isHiring ? 'yes' : '', freelance_score: String(freelanceScore(a.yc)), note: why, bio: a.bio.slice(0, 200) }
    if (email && !skipEmails.has(email)) confirmed.push(row)
    else if (!email) unconfirmed.push(row)
    save()
  }

  // IIT Bombay first, then by freelance potential
  const byScore = (x: Record<string, string>, y: Record<string, string>) =>
    Number(y.school === 'IIT Bombay') - Number(x.school === 'IIT Bombay') || Number(y.freelance_score) - Number(x.freelance_score)
  confirmed.sort(byScore)
  unconfirmed.sort(byScore)
  const write = (file: string, rows: Record<string, string>[], cols: string[]) =>
    fs.writeFileSync(path.join('data', file), [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n')
  write('contacts_iit_alumni.csv', confirmed, ['email', 'name', 'first_name', 'title', 'role', 'company', 'company_domain', 'location', 'school', 'team_size', 'batch', 'hiring', 'freelance_score', 'email_source'])
  write('iit_alumni_unconfirmed.csv', unconfirmed, ['name', 'title', 'company', 'company_domain', 'location', 'school', 'team_size', 'batch', 'hiring', 'freelance_score', 'note', 'bio'])
  console.log(`\n${confirmed.length} confirmed → data/contacts_iit_alumni.csv; ${unconfirmed.length} without a confirmed address → data/iit_alumni_unconfirmed.csv`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
