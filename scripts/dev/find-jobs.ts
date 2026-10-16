/**
 * Finds open roles that fit you at companies in data/contacts_db.csv, using the public
 * job-board APIs of Greenhouse, Lever and Ashby (built for reading; no login, no scraping).
 *
 *   npx tsx --env-file=.env.local scripts/dev/find-jobs.ts [--all-locations]
 *
 * Output: data/jobs.csv (company, title, location, apply URL, …), best matches first,
 * and data/jobs.json (the same jobs with their descriptions).
 * Board lookups are cached in data/.jobs-cache.json.
 */
import fs from 'fs'
import path from 'path'

const CACHE = path.join('data', '.jobs-cache.json')
const TITLE_RE = /\b(ai|ml|machine learning|llm|genai|gen ai|applied (ai|scientist)|backend|back-end|software (engineer|developer)|sde|full[- ]?stack|data scientist|founding engineer|platform engineer|research engineer|python)\b/i
const NOT_ENGINEERING_RE = /\b(manager|director|sales|gtm|marketing|recruit|product manager|account|business)\b/i
// "Oakland, CA", "Lehi, UT" (case-sensitive on purpose)
const US_STATE_RE = /,\s*(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/
const SENIOR_RE = /\b(staff|principal|director|head of|vp|vice president|manager|lead|architect|sr\.?|senior|iii|iv)\b/i
const INDIA_RE = /india|bengaluru|bangalore|mumbai|pune|hyderabad|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad/i
const REMOTE_RE = /remote|anywhere|worldwide|global/i
// "Remote" tied to another country isn't open to you
const ELSEWHERE_RE = /united states|\busa?\b|america|canada|europe|\buk\b|united kingdom|brazil|latam|mexico|germany|france|spain|poland|netherlands|emea|singapore|australia|london|new york|san francisco|california|boston|seattle|austin|toronto|berlin|belo horizonte|curitiba|\b(pst|est|cet)\b/i

type Ats = 'greenhouse' | 'lever' | 'ashby'
interface Board { ats: Ats; slug: string; fromSite?: boolean }
interface Posting { title: string; location: string; url: string; ats: Ats; posted: string; text: string }
interface Job { company: string; domain: string; title: string; location: string; url: string; ats: Ats; posted: string; fit: number; text: string }

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

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'EmailReach job search' } })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function getText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'Mozilla/5.0 (EmailReach job search)' } })
    return res.ok ? (await res.text()).slice(0, 2_000_000) : ''
  } catch {
    return ''
  }
}

/** Board links on the company's own homepage / careers page. */
async function boardsFromSite(domain: string): Promise<Board[]> {
  const html = (await Promise.all([`https://${domain}`, `https://${domain}/careers`, `https://${domain}/jobs`].map(getText))).join('\n')
  const found: Board[] = []
  for (const m of html.matchAll(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/gi)) found.push({ ats: 'greenhouse', slug: m[1], fromSite: true })
  for (const m of html.matchAll(/jobs\.lever\.co\/([a-z0-9_.-]+)/gi)) found.push({ ats: 'lever', slug: m[1], fromSite: true })
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/gi)) found.push({ ats: 'ashby', slug: decodeURIComponent(m[1]), fromSite: true })
  return found.filter((b) => !['embed', 'api', 'js'].includes(b.slug.toLowerCase()))
}

function slugGuesses(company: string, domain: string): string[] {
  const label = domain.split('.')[0]
  const name = company.toLowerCase().replace(/\(.*?\)|\b(inc|pvt|ltd|private|limited|technologies|labs|ai)\b|[^a-z0-9 ]/g, '').trim()
  // Short guesses ("ai", "app") tend to hit some other company's board
  return [...new Set([label, name.replace(/\s+/g, ''), name.replace(/\s+/g, '-')].filter((s) => s.length >= 4))]
}

const plain = (html: string) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').slice(0, 5000)

async function fetchBoard(b: Board): Promise<Posting[] | null> {
  if (b.ats === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`)
    return d?.jobs ? d.jobs.map((j: any) => ({
      title: j.title, location: j.location?.name || '', url: j.absolute_url, ats: b.ats, posted: (j.updated_at || '').slice(0, 10), text: plain(j.content || ''),
    })) : null
  }
  if (b.ats === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${b.slug}?mode=json`)
    return Array.isArray(d) ? d.map((j: any) => ({
      title: j.text, location: [j.categories?.location, j.workplaceType].filter(Boolean).join(' · '), url: j.hostedUrl, ats: b.ats,
      posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '', text: String(j.descriptionPlain || '').slice(0, 5000),
    })) : null
  }
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}`)
  return d?.jobs ? d.jobs.filter((j: any) => j.isListed !== false).map((j: any) => ({
    title: j.title, location: [j.location, j.isRemote ? 'Remote' : '', ...(j.secondaryLocations || []).map((s: any) => s.location)].filter(Boolean).join(' · '),
    url: j.jobUrl, ats: b.ats, posted: (j.publishedAt || '').slice(0, 10), text: String(j.descriptionPlain || '').slice(0, 5000),
  })) : null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const companyName = (company: string) => company.replace(/\(.*?\)|\b(inc|pvt|ltd|private|limited)\b\.?/gi, '').trim()

/** Is this board really the company's? Linked boards must be named like it; guessed ones must mention its domain. */
function boardBelongs(b: Board, postings: Posting[], company: string, domain: string): boolean {
  const label = norm(domain.split('.')[0])
  const name = norm(companyName(company))
  const slug = norm(b.slug)
  if (b.fromSite) return slug.length >= 3 && [label, name].some((x) => x.length >= 3 && (slug.includes(x) || x.includes(slug)))
  // Names are often common words ("Weave", "Pulse"), so only the company's own domain counts
  return postings.some((p) => p.text.toLowerCase().includes(domain))
}

function fitScore(title: string, location: string, allLocations: boolean): number {
  if (!TITLE_RE.test(title) || NOT_ENGINEERING_RE.test(title)) return 0
  const elsewhere = ELSEWHERE_RE.test(location) || US_STATE_RE.test(location)
  if (!allLocations && !(INDIA_RE.test(location) || (REMOTE_RE.test(location) && !elsewhere))) return 0
  let score = 50
  if (/\b(applied ai|ai engineer|ml engineer|machine learning engineer|llm|genai|founding engineer)\b/i.test(title)) score += 30
  else if (/\b(backend|back-end|software engineer|sde|full[- ]?stack)\b/i.test(title)) score += 15
  if (SENIOR_RE.test(title)) score -= 30
  else if (/\b(sde|engineer)[- ]?(2|ii|3|iii)\b|\bsde ?2\/3\b/i.test(title)) score -= 15
  if (/\b(intern|new grad|graduate|junior|entry|associate|sde[- ]?(1|i)\b|engineer i\b)/i.test(title)) score += 15
  if (INDIA_RE.test(location)) score += 10
  return Math.max(score, 1)
}

async function main() {
  const allLocations = process.argv.includes('--all-locations')
  const cache: Record<string, Board | null> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}

  // One entry per company (skip companies that already said no)
  const rows = parseCsv(fs.readFileSync(path.join('data', 'contacts_db.csv'), 'utf8'))
  const companies = new Map<string, string>()
  const declined = new Set(rows.filter((r) => ['rejection', 'not_hiring', 'unsubscribe'].includes(r.reply_category)).map((r) => r.domain))
  for (const r of rows) if (r.domain && !declined.has(r.domain) && !companies.has(r.domain)) companies.set(r.domain, r.company)
  console.log(`${companies.size} companies to check`)

  const jobs: Job[] = []
  let checked = 0
  let withBoard = 0
  const queue = [...companies.entries()]
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const [domain, company] = queue.shift()!
      let board = cache[domain]
      let list: Awaited<ReturnType<typeof fetchBoard>> = null
      if (board) list = await fetchBoard(board)
      else if (board === undefined) {
        const tries: Board[] = [
          ...(await boardsFromSite(domain)),
          ...slugGuesses(company, domain).flatMap((slug) => (['ashby', 'greenhouse', 'lever'] as Ats[]).map((ats) => ({ ats, slug }))),
        ]
        for (const t of tries) {
          list = await fetchBoard(t)
          if (list && list.length && boardBelongs(t, list, company, domain)) { board = t; break }
          list = null
        }
        cache[domain] = board || null
      }
      if (board && list) {
        withBoard++
        for (const j of list) {
          const fit = fitScore(j.title, j.location, allLocations)
          if (fit > 0) jobs.push({ company, domain, fit, title: j.title, location: j.location, url: j.url, ats: j.ats, posted: j.posted, text: j.text })
        }
      }
      if (++checked % 100 === 0) {
        fs.writeFileSync(CACHE, JSON.stringify(cache))
        console.log(`  checked ${checked}/${companies.size}, ${withBoard} job boards, ${jobs.length} matching roles`)
      }
    }
  }))
  fs.writeFileSync(CACHE, JSON.stringify(cache))

  jobs.sort((a, b) => b.fit - a.fit || b.posted.localeCompare(a.posted))
  const cols: (keyof Job)[] = ['fit', 'company', 'title', 'location', 'posted', 'url', 'ats', 'domain']
  fs.writeFileSync(path.join('data', 'jobs.csv'), [cols.join(','), ...jobs.map((j) => cols.map((c) => csvCell(j[c])).join(','))].join('\n') + '\n')
  // Full descriptions, for prepare-applications.ts
  fs.writeFileSync(path.join('data', 'jobs.json'), JSON.stringify(jobs, null, 2))
  console.log(`\n${jobs.length} matching roles at ${new Set(jobs.map((j) => j.domain)).size} companies (${withBoard} job boards found) → data/jobs.csv`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
