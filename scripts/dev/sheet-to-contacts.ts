/**
 * Turns an exported contacts spreadsheet (all tabs) into a clean, deduplicated
 * contacts database with verification status, and tries to fill in missing
 * emails from company email patterns.
 *
 * Input is a JSON export of the workbook: { [tabName]: { rows: string[][], links: { "r,c": url } } }
 * (scratchpad helper exports it from the .xlsx download of the Google Sheet).
 *
 *   npx tsx --env-file=.env.local scripts/dev/sheet-to-contacts.ts <tabs.json> [--out data] [--discover 30]
 *
 * Outputs (personal data — data/ is gitignored):
 *   contacts_all.csv            every unique email, merged across tabs
 *   contacts_ready.csv          verified-safe emails that came from the sheet or the company site
 *   contacts_missing_email.csv  people with no email, or only an unconfirmed pattern guess
 */
import fs from 'fs'
import path from 'path'
import { extractEmailsFromText, fetchPublicPage } from '../../lib/email/extractor'
import { PATTERNS, applyPattern, inferPattern } from '../../lib/email/email-patterns'
import { findCompanyContacts, isConfirmed, splitName } from '../../lib/email/people-finder'
import { verifyEmailsBatch } from '../../lib/email/verifier'

type Source = 'sheet' | 'website' | 'pattern_guess'

interface Row {
  tab: string
  row: number // 1-based sheet row
  name: string
  emailCell: string
  linkedin: string
  company: string
  title: string
  notes: string
  dateSent: string
  outreachStatus: string
  remark: string
}

interface Contact {
  email: string
  name: string
  first_name: string
  last_name: string
  title: string
  company: string
  company_domain: string
  linkedin: string
  phone: string
  source_tab: string[]
  source_row: string[]
  notes: string[]
  date_sent: string
  outreach_status: string
  remark: string
  email_source: Source
  confidence: number
  pattern: string
  verification_status: string
  verification_reason: string
}

const FREE_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'protonmail.com', 'proton.me', 'rediffmail.com', 'aol.com', 'zoho.com',
])

// Header aliases → field
const HEADER_MAP: Record<string, Exclude<keyof Row, 'row' | 'tab'>> = {
  name: 'name', 'full name': 'name',
  email: 'emailCell', 'e-mail': 'emailCell', mail: 'emailCell',
  linkedin: 'linkedin', 'linkedin url': 'linkedin',
  company: 'company', 'current company': 'company', organisation: 'company', organization: 'company',
  designation: 'title', title: 'title', role: 'title', position: 'title',
  summary: 'notes',
  'date sent': 'dateSent',
  status: 'outreachStatus',
  remark: 'remark', remarks: 'remark',
}

const NOT_A_COMPANY = /^(-+|india|.*\((india|usa|uk)\)|bengaluru|bangalore|mumbai|delhi|new delhi|gurgaon|gurugram|pune|hyderabad|chennai|noida|n\/?a|none|stealth)$/i

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeCompany(company: string): string {
  return company.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llp|technologies|technology|labs)\b\.?/g, '').replace(/[^a-z0-9]+/g, '')
}

function normalizeTitle(title: string): string {
  // Tracxn export truncates "Co-Founder" to "Co" in some tabs
  return /^co$/i.test(title) ? 'Co-Founder' : title
}

function csvCell(value: unknown): string {
  const s = Array.isArray(value) ? value.join('; ') : String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(file: string, columns: string[], rows: Record<string, unknown>[]) {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))]
  fs.writeFileSync(file, lines.join('\n') + '\n')
}

function readTabs(file: string): Row[] {
  const tabs: Record<string, { rows: string[][]; links: Record<string, string> }> = JSON.parse(fs.readFileSync(file, 'utf8'))
  const out: Row[] = []
  for (const [tab, { rows, links }] of Object.entries(tabs)) {
    const header = (rows[0] || []).map((h) => clean(h).toLowerCase())
    const fields = header.map((h) => HEADER_MAP[h])
    rows.slice(1).forEach((cells, i) => {
      if (!cells.some((c) => clean(c))) return
      const row: Row = { tab, row: i + 2, name: '', emailCell: '', linkedin: '', company: '', title: '', notes: '', dateSent: '', outreachStatus: '', remark: '' }
      cells.forEach((cell, c) => {
        const field = fields[c]
        let value = clean(cell)
        const link = links[`${i + 1},${c}`]
        if (field === 'linkedin' && link && /linkedin\.com/i.test(link)) value = link
        if (field === 'emailCell' && link?.startsWith('mailto:')) value = `${value} ${link}`
        if (field) {
          const key = field
          row[key] = row[key] ? `${row[key]} ${value}` : value
        }
      })
      out.push(row)
    })
  }
  return out
}

/** Finds a company's own website by trying common domains and checking the page mentions the company. */
async function discoverDomain(company: string): Promise<string | null> {
  const slug = company.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')
  if (slug.length < 3) return null
  const firstWord = company.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '')
  for (const domain of [`${slug}.com`, `${slug}.in`, `${slug}.ai`, `${slug}.io`, `${slug}.co`, `${slug}.co.in`]) {
    try {
      const page = await fetchPublicPage(`https://${domain}`)
      const head = page.body.slice(0, 20000).toLowerCase()
      if (head.includes(company.toLowerCase()) || (firstWord.length >= 4 && head.includes(firstWord))) {
        return new URL(page.url).hostname.replace(/^www\./, '')
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

async function main() {
  const [input, ...rest] = process.argv.slice(2)
  if (!input) throw new Error('Usage: sheet-to-contacts.ts <tabs.json> [--out data] [--discover 30]')
  const outDir = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : 'data'
  const discoverLimit = rest.includes('--discover') ? Number(rest[rest.indexOf('--discover') + 1]) : 30
  fs.mkdirSync(outDir, { recursive: true })

  const rows = readTabs(input)
  const tabCounts: Record<string, { rows: number; withEmail: number }> = {}

  // 1. Emails found in the sheet (email column + any email inside other cells)
  const contacts = new Map<string, Contact>()
  const missing: Row[] = []
  let duplicateMerges = 0

  for (const r of rows) {
    const counts = (tabCounts[r.tab] ||= { rows: 0, withEmail: 0 })
    counts.rows++
    const found = new Set<string>()
    for (const text of [r.emailCell, r.notes, r.remark]) {
      for (const e of extractEmailsFromText(text.replace(/mailto:/gi, ' '))) found.add(e.email)
    }
    if (found.size === 0) {
      missing.push(r)
      continue
    }
    counts.withEmail++
    const split = splitName(r.name)
    for (const email of found) {
      const domain = email.split('@')[1]
      const existing = contacts.get(email)
      if (existing) {
        duplicateMerges++
        if (!existing.source_tab.includes(r.tab)) existing.source_tab.push(r.tab)
        existing.source_row.push(`${r.tab}!${r.row}`)
        existing.title ||= normalizeTitle(r.title)
        existing.company ||= NOT_A_COMPANY.test(r.company) ? '' : r.company
        existing.linkedin ||= r.linkedin
        if (r.notes) existing.notes.push(r.notes)
        existing.date_sent ||= r.dateSent
        if (r.outreachStatus === 'Reply' || !existing.outreach_status) existing.outreach_status = r.outreachStatus || existing.outreach_status
        existing.remark ||= r.remark
        continue
      }
      contacts.set(email, {
        email,
        name: r.name,
        first_name: split?.firstName || r.name.split(' ')[0] || '',
        last_name: split?.lastName || '',
        title: normalizeTitle(r.title),
        company: NOT_A_COMPANY.test(r.company) ? '' : r.company,
        company_domain: FREE_DOMAINS.has(domain) ? '' : domain,
        linkedin: r.linkedin,
        phone: '',
        source_tab: [r.tab],
        source_row: [`${r.tab}!${r.row}`],
        notes: r.notes ? [r.notes] : [],
        date_sent: r.dateSent,
        outreach_status: r.outreachStatus,
        remark: r.remark,
        email_source: 'sheet',
        confidence: 90,
        pattern: '',
        verification_status: '',
        verification_reason: '',
      })
    }
  }
  const missingBefore = missing.length

  // 2. Company → domain and per-domain patterns learned from the sheet's own emails
  const domainByCompany = new Map<string, string>()
  const knownByDomain = new Map<string, { email: string; first: string; last: string }[]>()
  for (const c of contacts.values()) {
    if (!c.company_domain) continue
    const key = normalizeCompany(c.company)
    if (key && !domainByCompany.has(key)) domainByCompany.set(key, c.company_domain)
    const list = knownByDomain.get(c.company_domain) || []
    list.push({ email: c.email, first: c.first_name, last: c.last_name })
    knownByDomain.set(c.company_domain, list)
  }
  // Most common pattern across the whole sheet (founder emails are usually {first}@)
  const globalScores = new Map<string, number>()
  for (const c of contacts.values()) {
    for (const p of PATTERNS) {
      if (applyPattern(p, c.first_name, c.last_name) === c.email.split('@')[0]) globalScores.set(p, (globalScores.get(p) || 0) + 1)
    }
  }
  const globalPattern = [...globalScores].sort((a, b) => b[1] - a[1])[0]?.[0] || '{first}'

  // People who have an email elsewhere in the sheet aren't really missing
  const emailedPeople = new Set([...contacts.values()].map((c) => `${c.name.toLowerCase()}|${normalizeCompany(c.company)}`))
  const stillMissing = missing.filter((r) => !emailedPeople.has(`${r.name.toLowerCase()}|${normalizeCompany(r.company)}`))
  const resolvedFromOtherTabs = missing.length - stillMissing.length

  // Same person listed twice without an email: keep one
  const uniqueMissing = new Map<string, Row>()
  for (const r of stillMissing) {
    const key = `${r.name.toLowerCase()}|${normalizeCompany(r.company)}`
    const prev = uniqueMissing.get(key)
    if (prev) {
      prev.tab = prev.tab.includes(r.tab) ? prev.tab : `${prev.tab}; ${r.tab}`
      continue
    }
    uniqueMissing.set(key, { ...r, title: normalizeTitle(r.title), company: NOT_A_COMPANY.test(r.company) ? '' : r.company })
  }

  // 3. Find websites for companies we have no domain for (time-boxed, decision makers first)
  const needDomain = [...new Set([...uniqueMissing.values()].map((r) => r.company).filter((c) => c && !domainByCompany.has(normalizeCompany(c))))]
  const priority = (company: string) => {
    const titles = [...uniqueMissing.values()].filter((r) => r.company === company).map((r) => r.title.toLowerCase())
    return titles.some((t) => /ceo|cto|founder|hr|talent|people|engineering/.test(t)) ? 0 : 1
  }
  needDomain.sort((a, b) => priority(a) - priority(b))
  const minutes = rest.includes('--minutes') ? Number(rest[rest.indexOf('--minutes') + 1]) : 6
  const discoveryDeadline = Date.now() + minutes * 60_000
  const websiteFinds: Contact[] = []
  let discovered = 0

  // Resumable: domains (or "no site found") are cached between runs
  const cachePath = path.join(outDir, '.domain-cache.json')
  const cache: Record<string, { domain: string | null; contacts?: any[]; pattern?: string }> = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    : {}
  const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache))

  const lookup = async (company: string) => {
    const key = normalizeCompany(company)
    if (!cache[key]) {
      const domain = await discoverDomain(company)
      cache[key] = { domain }
      if (domain) {
        try {
          const { contacts: found, company: info } = await findCompanyContacts(domain, {
            roles: [],
            verify: false,
            guessPatterns: false,
            deadline: Math.min(discoveryDeadline, Date.now() + 25_000),
          })
          cache[key].contacts = found.filter((f) => f.source === 'website')
          cache[key].pattern = info.pattern || ''
        } catch {
          // keep the domain even if the crawl failed
        }
      }
    }
    const hit = cache[key]
    if (!hit.domain) return
    discovered++
    domainByCompany.set(key, hit.domain)
    for (const f of hit.contacts || []) {
      const known = knownByDomain.get(hit.domain) || []
      if (f.firstName) known.push({ email: f.email, first: f.firstName, last: f.lastName })
      knownByDomain.set(hit.domain, known)
      websiteFinds.push({
        email: f.email, name: f.name, first_name: f.firstName, last_name: f.lastName, title: f.title,
        company, company_domain: hit.domain, linkedin: '', phone: '', source_tab: [], source_row: [f.sourceUrl || hit.domain],
        notes: [], date_sent: '', outreach_status: '', remark: '', email_source: 'website', confidence: 85,
        pattern: hit.pattern || '', verification_status: '', verification_reason: '',
      })
    }
  }

  const queue = needDomain.slice(0, discoverLimit)
  let next = 0
  let checked = 0
  const worker = async () => {
    while (next < queue.length && Date.now() < discoveryDeadline) {
      const company = queue[next++]
      await lookup(company)
      if (++checked % 25 === 0) {
        saveCache()
        console.log(`  websites: checked ${checked}/${queue.length}, found ${discovered}`)
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  saveCache()

  // 4. Pattern guesses for people still without an email
  const guesses: Contact[] = []
  const unresolved: (Row & { company_domain: string; reason: string })[] = []
  for (const r of uniqueMissing.values()) {
    const split = splitName(r.name)
    const domain = domainByCompany.get(normalizeCompany(r.company)) || ''
    const websiteMatch = websiteFinds.find((w) => w.company_domain === domain && split && w.first_name.toLowerCase() === split.firstName.toLowerCase())
    if (websiteMatch) {
      websiteMatch.title ||= r.title
      websiteMatch.source_tab.push(r.tab)
      websiteMatch.source_row.push(`${r.tab}!${r.row}`)
      websiteMatch.linkedin ||= r.linkedin
      continue
    }
    if (!domain || !split) {
      unresolved.push({ ...r, company_domain: domain, reason: !split ? 'Name could not be split into first/last' : 'Company website/domain unknown' })
      continue
    }
    const observed = inferPattern(knownByDomain.get(domain) || [])
    const pattern = observed || globalPattern
    const email = applyPattern(pattern, split.firstName, split.lastName)
    if (!email) {
      unresolved.push({ ...r, company_domain: domain, reason: `Pattern ${pattern} needs a last name` })
      continue
    }
    guesses.push({
      email: `${email}@${domain}`, name: r.name, first_name: split.firstName, last_name: split.lastName,
      title: r.title, company: r.company, company_domain: domain, linkedin: r.linkedin, phone: '',
      source_tab: r.tab.split('; '), source_row: [`${r.tab}!${r.row}`], notes: r.notes ? [r.notes] : [],
      date_sent: r.dateSent, outreach_status: r.outreachStatus, remark: r.remark,
      email_source: 'pattern_guess', confidence: observed ? 55 : 35,
      pattern: `${pattern}${observed ? ' (seen at this company)' : ' (most common in sheet)'}`,
      verification_status: '', verification_reason: '',
    })
  }

  // 5. Verify everything (MX-level unless Reacher / MillionVerifier / SMTP probing is configured)
  const all = [...contacts.values()]
  for (const w of websiteFinds) if (!contacts.has(w.email)) all.push(w)
  for (const g of guesses) if (!all.some((c) => c.email === g.email)) all.push(g)
  const results = await verifyEmailsBatch(all.map((c) => c.email), 10)
  for (const c of all) {
    const v = results.get(c.email)
    c.verification_status = v?.status || 'risky'
    c.verification_reason = v?.reason || ''
    if (c.email_source === 'pattern_guess' && c.verification_status === 'safe' && !isConfirmed(v)) {
      c.verification_status = 'risky'
      c.verification_reason = 'Guessed from company email pattern — mailbox not confirmed'
    }
    if (c.email_source === 'pattern_guess' && isConfirmed(v)) c.confidence = Math.min(95, c.confidence + 30)
  }

  // 6. Write outputs
  const allColumns = ['email', 'name', 'first_name', 'last_name', 'title', 'company', 'company_domain', 'linkedin', 'phone',
    'email_source', 'confidence', 'pattern', 'verification_status', 'verification_reason',
    'outreach_status', 'date_sent', 'remark', 'source_tab', 'source_row', 'notes']
  const order = { safe: 0, risky: 1, invalid: 2 } as Record<string, number>
  all.sort((a, b) => (order[a.verification_status] - order[b.verification_status]) || a.company.localeCompare(b.company))
  writeCsv(path.join(outDir, 'contacts_all.csv'), allColumns, all as any)

  const ready = all.filter((c) => c.verification_status === 'safe' && c.email_source !== 'pattern_guess' && c.outreach_status !== 'Reply')
  writeCsv(path.join(outDir, 'contacts_ready.csv'), ['email', 'name', 'company', 'title', 'first_name'], ready as any)

  const missingRows = [
    ...unresolved.map((r) => ({ name: r.name, title: r.title, company: r.company, company_domain: r.company_domain, linkedin: r.linkedin, best_guess: '', guess_status: '', reason: r.reason, source_tab: r.tab, source_row: `${r.tab}!${r.row}` })),
    ...all.filter((c) => c.email_source === 'pattern_guess' && c.verification_status !== 'safe').map((c) => ({
      name: c.name, title: c.title, company: c.company, company_domain: c.company_domain, linkedin: c.linkedin,
      best_guess: c.email, guess_status: c.verification_status, reason: c.verification_reason, source_tab: c.source_tab, source_row: c.source_row,
    })),
  ]
  writeCsv(path.join(outDir, 'contacts_missing_email.csv'),
    ['name', 'title', 'company', 'company_domain', 'linkedin', 'best_guess', 'guess_status', 'reason', 'source_tab', 'source_row'], missingRows)

  // 7. Summary
  const count = (pred: (c: Contact) => boolean) => all.filter(pred).length
  const companies = new Map<string, number>()
  for (const c of all) if (c.company) companies.set(c.company, (companies.get(c.company) || 0) + 1)
  console.log(JSON.stringify({
    tabs: tabCounts,
    sheetRows: rows.length,
    uniqueEmailsFromSheet: contacts.size,
    duplicateMerges,
    websiteEmails: websiteFinds.length,
    patternGuesses: guesses.length,
    globalPattern,
    domainsDiscovered: discovered,
    verification: {
      safe: count((c) => c.verification_status === 'safe'),
      risky: count((c) => c.verification_status === 'risky'),
      invalid: count((c) => c.verification_status === 'invalid'),
    },
    ready: ready.length,
    alreadyReplied: count((c) => c.outreach_status === 'Reply'),
    missing: {
      rowsWithoutEmail: missingBefore,
      resolvedFromOtherTabs,
      uniquePeopleMissing: uniqueMissing.size,
      guessed: guesses.length,
      stillMissing: unresolved.length,
    },
    topCompanies: [...companies].sort((a, b) => b[1] - a[1]).slice(0, 10),
  }, null, 2))
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
