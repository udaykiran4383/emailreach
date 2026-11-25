/**
 * Pulls founders/leaders and their work emails from the Tracxn API (uses your API credits),
 * keeping people whose Tracxn bio mentions an IIT (IIT Bombay first).
 * Every API response is cached in data/.tracxn-cache.json, so nothing is ever fetched (or billed) twice.
 *
 *   npx tsx --env-file=.env.local scripts/dev/tracxn-alumni.ts --domains composio.dev,cekura.ai [--max-emails 50]
 *   npx tsx --env-file=.env.local scripts/dev/tracxn-alumni.ts --college "IIT Bombay" --country "United States" --max-emails 5000
 *   npx tsx --env-file=.env.local scripts/dev/tracxn-alumni.ts --city "San Francisco" --pages 2 [--max-emails 50]
 *
 * Output: data/contacts_tracxn.csv (Tracxn emails; confirm them before sending).
 */
import fs from 'fs'
import path from 'path'

const CACHE = path.join('data', '.tracxn-cache.json')
const API = 'https://platform.tracxn.com/api/2.2/companies'
const PAGE_SIZE = 20

const IITB_RE = /\bIIT[\s-]?Bombay\b|\bIIT[\s-]?B\b|\bIITB\b|Indian Institute of Technology[\s,(–-]*Bombay|\bIIT[\s-]?Mumbai\b/i
const IIT_RE = /\bIIT(s|[\s-]?[A-Z][a-z]+|[A-Z]{1,3})?\b|Indian Institute of Technology/
const school = (bio: string) => (IITB_RE.test(bio) ? 'IIT Bombay' : IIT_RE.test(bio) ? bio.match(/\bIIT[\s-]?[A-Z][a-z]+/)?.[0] || 'IIT' : '')

const csvCell = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function query(filter: Record<string, unknown>, from = 0): Promise<any[]> {
  const cache: Record<string, any> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const key = JSON.stringify({ filter, from })
  if (!cache[key]) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { accesstoken: process.env.TRACXN_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, from, size: PAGE_SIZE }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = await res.json()
    if (!res.ok || body.errorCode) throw new Error(`Tracxn ${res.status}: ${body.message || JSON.stringify(body).slice(0, 200)}`)
    cache[key] = body
    fs.writeFileSync(CACHE, JSON.stringify(cache))
  }
  return cache[key].result || []
}

async function main() {
  if (!process.env.TRACXN_API_KEY) throw new Error('TRACXN_API_KEY is not set in .env.local')
  const args = process.argv.slice(2)
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const maxEmails = Number(arg('--max-emails') || 50)

  const companies: any[] = []
  if (arg('--domains')) {
    for (const d of arg('--domains')!.split(',').map((s) => s.trim()).filter(Boolean)) companies.push(...(await query({ domain: [d] })))
  }
  // All companies in a country with alumni of a college on the team, e.g. --college "IIT Bombay" --country "United States"
  if (arg('--college')) {
    const filter = { teamBackgroundName: [arg('--college')], country: [arg('--country') || 'United States'] }
    for (let from = 0; ; from += PAGE_SIZE) {
      let page: any[]
      try {
        page = await query(filter, from)
      } catch (err) {
        // Out of credits or rate-limited: keep what's cached so far; a re-run continues from here
        console.warn(`  stopped at ${from}: ${err instanceof Error ? err.message : err}`)
        break
      }
      companies.push(...page)
      console.log(`  ${companies.length} companies`)
      if (page.length < PAGE_SIZE) break
    }
  }
  if (arg('--city')) {
    for (let p = 0; p < Number(arg('--pages') || 1); p++) companies.push(...(await query({ country: ['United States'], city: [arg('--city')] }, p * PAGE_SIZE)))
  }

  const rows: Record<string, string>[] = []
  const seen = new Set<string>()
  for (const c of companies) {
    for (const e of c.employeeInfo?.employeeList || []) {
      const email = String(e.emailInfo?.primaryEmail || '').toLowerCase()
      const s = school(String(e.shortBio || ''))
      if (!email || !s || seen.has(email)) continue
      seen.add(email)
      rows.push({
        email, name: e.name || '', first_name: String(e.name || '').split(/\s+/)[0], title: e.designation || '',
        role: /cto|technolog/i.test(e.designation || '') ? 'cto' : /founder|ceo|chief exec/i.test(e.designation || '') ? 'ceo' : 'other',
        company: c.name, company_domain: c.domain, location: [c.location?.city, c.location?.country].filter(Boolean).join(', '),
        school: s, employees: String(c.latestEmployeeCount?.value ?? ''), founded: String(c.foundedYear ?? ''), bio: e.shortBio || '', email_source: 'tracxn',
      })
    }
  }
  rows.sort((a, b) => Number(b.school === 'IIT Bombay') - Number(a.school === 'IIT Bombay'))
  const out = rows.slice(0, maxEmails)
  const cols = ['email', 'name', 'first_name', 'title', 'role', 'company', 'company_domain', 'location', 'school', 'employees', 'founded', 'bio', 'email_source']
  // Never replace an earlier list with an empty one (e.g. when credits ran out); college pulls get their own file
  const file = arg('--college') ? 'contacts_tracxn_college.csv' : 'contacts_tracxn.csv'
  if (!out.length) return console.log(`${companies.length} companies read; nothing new, data/${file} left as it was`)
  fs.writeFileSync(path.join('data', file), [cols.join(','), ...out.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\n') + '\n')
  console.log(`${companies.length} companies read; ${rows.length} IIT alumni with emails (${rows.filter((r) => r.school === 'IIT Bombay').length} IIT Bombay) → data/${file} (${out.length})`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
