import { extractEmailsFromText, fetchPublicPage, guessCompanyFromEmail } from './extractor'
import { verifyEmailsBatch, type VerificationResult } from './verifier'
import { PATTERNS, applyPattern, inferPattern, normalizeNamePart } from './email-patterns'
import { domainSearch, emailFinder, isHunterEnabled, type HunterEmail } from './providers/hunter'

/**
 * Finds decision makers (HR, tech leads, CEO, CTO) for a company from its public
 * website, optionally Hunter.io, and the company's email pattern.
 * Guessed addresses are only marked 'safe' when a deep check confirmed the mailbox.
 */

export type Role = 'hr' | 'tech_lead' | 'ceo' | 'cto'
export const ALL_ROLES: Role[] = ['hr', 'tech_lead', 'ceo', 'cto']

export interface Contact {
  email: string
  name: string
  firstName: string
  lastName: string
  title: string
  role: Role | 'other'
  company: string
  domain: string
  source: 'website' | 'pattern' | 'hunter'
  sourceUrl?: string
  confidence: number // 0-100
  verification?: { status: 'safe' | 'risky' | 'invalid'; reason?: string }
}

export interface CompanyResult {
  input: string
  domain: string
  company: string
  pattern: string | null // e.g. '{first}.{last}'
  patternSource: 'observed' | 'hunter' | null
  catchAll: boolean | null
  pagesFetched: number
  peopleFound: number
  errors: string[]
}

export interface FindContactsOptions {
  roles: Role[] // empty = all (including 'other')
  verify: boolean
  guessPatterns: boolean
  deadline: number // epoch ms
}

export interface Person {
  name: string
  firstName: string
  lastName: string
  title: string
  role: Role | 'other'
  sourceUrl?: string
}

// ---------------------------------------------------------------------------
// Role classification

const ROLE_RULES: { role: Role; pattern: RegExp }[] = [
  { role: 'cto', pattern: /\b(chief technology|cto|vp,? (of )?engineering|vice president,? (of )?engineering|head of engineering|chief architect)\b/i },
  { role: 'ceo', pattern: /\b(chief executive|ceo|managing director)\b/i },
  { role: 'hr', pattern: /\b(hr|hrbp|human resources?|talent|recruit\w*|people (ops|operations|partner|team|lead|manager)|head of people|hiring|chro)\b/i },
  { role: 'tech_lead', pattern: /\b(tech(nical)? lead|engineering manager|lead (software |backend |frontend |full[- ]?stack )?(engineer|developer)|principal (software )?engineer|staff (software )?engineer|architect|director of engineering|engineering director|head of (technology|tech|product engineering))\b/i },
]
const FOUNDER = /\bco-?founder\b|\bfounder\b/i

export function classifyRole(title: string): Role | 'other' {
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(title)) return rule.role
  }
  // A plain founder / co-founder with no other role is usually the person to reach at the top
  if (FOUNDER.test(title)) return 'ceo'
  return 'other'
}

// Words that show a text is a job title (used to pair names with titles)
const TITLE_HINT = /\b(chief|officer|ceo|cto|coo|cfo|cmo|chro|founder|president|vp|director|head|manager|lead|engineer|developer|architect|recruit\w*|talent|hr|human resources|people|partner|executive|principal|staff|consultant|specialist|analyst|designer|scientist|owner|managing)\b/i

// ---------------------------------------------------------------------------
// Name validation

const NAV_WORDS = new Set([
  'about', 'contact', 'our', 'team', 'home', 'careers', 'career', 'jobs', 'read', 'more', 'learn', 'meet', 'join',
  'us', 'the', 'services', 'products', 'product', 'leadership', 'company', 'news', 'blog', 'privacy', 'terms', 'policy',
  'view', 'profile', 'all', 'and', 'for', 'with', 'get', 'started', 'sign', 'in', 'up', 'login', 'open', 'roles',
  'board', 'directors', 'management', 'people', 'founders', 'solutions', 'pricing', 'resources', 'case', 'studies',
  'cookie', 'cookies', 'menu', 'search', 'apply', 'now', 'see', 'linkedin', 'twitter', 'email', 'phone', 'office',
  'chief', 'officer', 'head', 'engineering', 'director', 'manager', 'executive', 'founder', 'co-founder',
])

export function splitName(name: string): { firstName: string; lastName: string } | null {
  const cleaned = name
    .replace(/\b(dr|mr|mrs|ms|prof)\.?\s+/gi, '')
    .replace(/,?\s+(jr|sr|ii|iii|phd|mba)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ')
  if (words.length < 2 || words.length > 4) return null
  if (/\d|@|https?:|[|<>{}[\]()]/.test(cleaned)) return null
  for (const word of words) {
    if (!/^\p{Lu}/u.test(word)) return null
    if (NAV_WORDS.has(word.toLowerCase())) return null
  }
  // Ignore all-caps strings longer than initials (usually headings like "OUR TEAM")
  if (cleaned === cleaned.toUpperCase() && cleaned.replace(/[^A-Z]/g, '').length > 4) return null
  const first = words[0].replace(/\.$/, '')
  const last = words[words.length - 1]
  if (normalizeNamePart(first).length < 2 || normalizeNamePart(last).length < 2) return null
  return { firstName: first, lastName: last }
}

// ---------------------------------------------------------------------------
// HTML helpers

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function withoutScripts(html: string): string {
  return html
    .replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

/** Text segments between tags, in document order. */
function textSegments(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((s) => decodeEntities(s).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// People extraction

function addPerson(people: Map<string, Person>, rawName: string, rawTitle: string, sourceUrl?: string) {
  const name = rawName.replace(/\s+/g, ' ').trim()
  const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!title || !TITLE_HINT.test(title)) return
  const parts = splitName(name)
  if (!parts) return
  const key = `${normalizeNamePart(parts.firstName)}|${normalizeNamePart(parts.lastName)}`
  const role = classifyRole(title)
  const existing = people.get(key)
  // Keep the more specific title (one that maps to a role beats 'other')
  if (existing && (existing.role !== 'other' || role === 'other')) return
  people.set(key, { name, ...parts, title, role, sourceUrl })
}

function walkJsonLd(node: any, people: Map<string, Person>, sourceUrl?: string, depth = 0) {
  if (!node || depth > 8) return
  if (Array.isArray(node)) {
    node.forEach((n) => walkJsonLd(n, people, sourceUrl, depth + 1))
    return
  }
  if (typeof node !== 'object') return
  const type = node['@type']
  const isPerson = type === 'Person' || (Array.isArray(type) && type.includes('Person'))
  if (isPerson && typeof node.name === 'string') {
    const title = typeof node.jobTitle === 'string' ? node.jobTitle : Array.isArray(node.jobTitle) ? node.jobTitle.join(', ') : ''
    addPerson(people, node.name, title, sourceUrl)
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walkJsonLd(value, people, sourceUrl, depth + 1)
  }
}

/** Extracts named people with job titles from a page. */
export function extractPeopleFromHtml(html: string, sourceUrl?: string): Person[] {
  const people = new Map<string, Person>()
  const clean = withoutScripts(html)

  // 1. JSON-LD Person objects
  for (const m of clean.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkJsonLd(JSON.parse(m[1].trim()), people, sourceUrl)
    } catch {
      // Invalid JSON-LD is common, ignore it
    }
  }

  const body = clean.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')

  // 2. Team cards: a name in a heading/strong, the title right after (or right before) it
  for (const m of body.matchAll(/<(h[2-6]|strong|b)\b[^>]*>([\s\S]{2,200}?)<\/\1>/gi)) {
    const name = stripTags(m[2])
    if (!splitName(name)) continue
    const start = m.index ?? 0
    const after = textSegments(body.slice(start + m[0].length, start + m[0].length + 600)).slice(0, 3)
    const before = textSegments(body.slice(Math.max(0, start - 300), start)).slice(-1)
    const title = [...after, ...before].find((s) => s.length <= 120 && TITLE_HINT.test(s) && !splitName(s))
    if (title) addPerson(people, name, title, sourceUrl)
  }

  // 3. "Name – Title" / "Name, Title" / "Name | Title" lines
  const lines = body
    .replace(/<(br|\/p|\/li|\/div|\/h\d|\/td|\/tr)\b[^>]*>/gi, '\n')
    .split('\n')
    .map((l) => stripTags(l))
    .filter((l) => l.length > 4 && l.length < 160)
  for (const line of lines) {
    const m = line.match(/^((?:\p{Lu}[\p{L}'.-]*\s+){1,3}\p{Lu}[\p{L}'.-]*)\s*(?:[–—-]|,|\|)\s*(.{2,100})$/u)
    if (m) addPerson(people, m[1], m[2], sourceUrl)
  }

  return [...people.values()]
}

// ---------------------------------------------------------------------------
// Domain / page discovery

const SOCIAL_HOSTS = /(^|\.)(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|github\.com|glassdoor\.\w+|crunchbase\.com|angel\.co|wellfound\.com)$/i
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'edu', 'gov', 'ltd', 'plc', 'gen', 'firm', 'ind', 'res'])
const PEOPLE_PAGE = /about|team|people|leadership|management|founders|our-team|company|careers|jobs|contact|\bhr\b/i

export function normalizeCompanyInput(input: string): { domain: string; homepage: string } | { error: string } {
  const raw = input.trim()
  if (!raw) return { error: 'Empty company' }
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^.*@/, '')}`)
  } catch {
    return { error: `Not a valid domain or URL: ${raw}` }
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (SOCIAL_HOSTS.test(host)) {
    return { error: `${host} is a social network — enter the company's own website instead (social sites are not scraped)` }
  }
  if (!host.includes('.')) return { error: `Not a valid domain: ${raw}` }
  const labels = host.split('.')
  const keep = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2
  const domain = labels.slice(-keep).join('.')
  return { domain, homepage: `https://${host === domain ? domain : host}/` }
}

function findPeopleLinks(html: string, base: URL, domain: string): string[] {
  const links: { url: string; score: number }[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/^(mailto|tel|javascript):/i.test(m[1])) continue
    let target: URL
    try {
      target = new URL(m[1], base)
    } catch {
      continue
    }
    const host = target.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== domain && !host.endsWith(`.${domain}`)) continue
    if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4)$/i.test(target.pathname)) continue
    const text = stripTags(m[2])
    if (!PEOPLE_PAGE.test(target.pathname) && !PEOPLE_PAGE.test(text)) continue
    target.hash = ''
    target.search = ''
    const key = target.toString()
    if (seen.has(key)) continue
    seen.add(key)
    // Leadership/team pages first: they name the CEO/CTO
    const haystack = `${target.pathname} ${text}`
    const score = /team|leadership|people|founders|management/i.test(haystack) ? 3 : /about|company/i.test(haystack) ? 2 : 1
    links.push({ url: key, score })
  }
  return links.sort((a, b) => b.score - a.score).map((l) => l.url)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Verification helpers

/** True when the mailbox was positively confirmed (verifier API "ok", or SMTP accepted on a non-catch-all domain). */
export function isConfirmed(result: VerificationResult | undefined): boolean {
  if (!result || result.status !== 'safe') return false
  const d = result.details || {}
  if (d.confirmed === true) return true
  if (d.api?.result === 'ok') return true
  return d.smtp?.status === 'safe' && d.smtp?.catchAll === false
}

function isCatchAll(result: VerificationResult | undefined): boolean {
  return result?.details?.catchAll === true || (!!result?.reason && /catch-all/i.test(result.reason))
}

function mapHunterStatus(status: string | null): Contact['verification'] | undefined {
  switch (status) {
    case 'valid':
      return { status: 'safe' }
    case 'accept_all':
      return { status: 'risky', reason: 'Catch-all domain (Hunter)' }
    case 'invalid':
      return { status: 'invalid', reason: 'Mailbox does not exist (Hunter)' }
    default:
      return undefined
  }
}

const GUESS_REASON = 'Guessed from company email pattern — mailbox not confirmed'

async function withDeadline<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return { value: fallback, timedOut: true }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), remaining)
  })
  try {
    return await Promise.race([promise.then((value) => ({ value, timedOut: false })), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Main entry

const HR_INBOX = /^(hr|careers?|jobs|talent|recruit\w*|people|hiring|join|joinus|work|resumes?|cv)$/
const CEO_INBOX = /^(ceo|founders?|cofounders?)$/
const SOURCE_RANK: Record<Contact['source'], number> = { website: 3, hunter: 2, pattern: 1 }
const ROLE_ORDER: Record<Contact['role'], number> = { ceo: 0, cto: 1, tech_lead: 2, hr: 3, other: 4 }

export async function findCompanyContacts(
  input: string,
  options: FindContactsOptions
): Promise<{ contacts: Contact[]; company: CompanyResult; truncated: boolean }> {
  const result: CompanyResult = {
    input,
    domain: '',
    company: '',
    pattern: null,
    patternSource: null,
    catchAll: null,
    pagesFetched: 0,
    peopleFound: 0,
    errors: [],
  }
  let truncated = false

  const normalized = normalizeCompanyInput(input)
  if ('error' in normalized) {
    result.errors.push(normalized.error)
    return { contacts: [], company: result, truncated }
  }
  const { domain, homepage } = normalized
  result.domain = domain
  result.company = guessCompanyFromEmail(`x@${domain}`) || domain

  const wantRole = (role: Role | 'other') =>
    options.roles.length === 0 ? true : role !== 'other' && options.roles.includes(role)

  // 1. Crawl the company website
  const people = new Map<string, Person>()
  const siteEmails = new Map<string, string>() // email -> page url
  const queue = [homepage]
  const visited = new Set<string>()
  const MAX_PAGES = 8
  while (queue.length > 0 && result.pagesFetched < MAX_PAGES) {
    // Leave time for verification after crawling
    if (Date.now() > options.deadline - 6000) {
      truncated = true
      break
    }
    const next = queue.shift()!
    if (visited.has(next)) continue
    visited.add(next)
    if (result.pagesFetched > 0) await sleep(300)
    try {
      const page = await fetchPublicPage(next)
      result.pagesFetched++
      for (const person of extractPeopleFromHtml(page.body, page.url)) {
        const key = `${normalizeNamePart(person.firstName)}|${normalizeNamePart(person.lastName)}`
        const existing = people.get(key)
        if (!existing || (existing.role === 'other' && person.role !== 'other')) people.set(key, person)
      }
      for (const found of extractEmailsFromText(page.body, page.url)) {
        const emailDomain = found.email.split('@')[1]
        if ((emailDomain === domain || emailDomain.endsWith(`.${domain}`)) && !siteEmails.has(found.email)) {
          siteEmails.set(found.email, page.url)
        }
      }
      if (visited.size === 1) {
        for (const link of findPeopleLinks(page.body, new URL(page.url), domain)) {
          if (!visited.has(link) && !queue.includes(link)) queue.push(link)
        }
      }
    } catch (error: any) {
      result.errors.push(`${next}: ${error?.name === 'AbortError' ? 'timeout' : error?.message || 'fetch failed'}`)
    }
  }

  const contacts: Contact[] = []
  const base = { company: result.company, domain }

  // 2. Website emails: attach to people when the local part matches their name
  const knownForPattern: { email: string; first: string; last: string }[] = []
  const personEmail = new Map<string, string>() // person key -> email
  for (const [email, sourceUrl] of siteEmails) {
    const local = email.split('@')[0]
    let matched: Person | undefined
    for (const [key, person] of people) {
      if (PATTERNS.some((p) => applyPattern(p, person.firstName, person.lastName) === local)) {
        matched = person
        personEmail.set(key, email)
        knownForPattern.push({ email, first: person.firstName, last: person.lastName })
        break
      }
    }
    if (matched) {
      contacts.push({
        ...base, email, name: matched.name, firstName: matched.firstName, lastName: matched.lastName,
        title: matched.title, role: matched.role, source: 'website', sourceUrl, confidence: 90,
      })
    } else if (HR_INBOX.test(local)) {
      contacts.push({ ...base, email, name: '', firstName: '', lastName: '', title: 'Recruiting inbox', role: 'hr', source: 'website', sourceUrl, confidence: 90 })
    } else if (CEO_INBOX.test(local)) {
      contacts.push({ ...base, email, name: '', firstName: '', lastName: '', title: 'Founders inbox', role: 'ceo', source: 'website', sourceUrl, confidence: 90 })
    }
  }

  // 3. Hunter (optional)
  let hunterPattern: string | null = null
  let hunterEmails: HunterEmail[] = []
  if (isHunterEnabled() && Date.now() < options.deadline - 4000) {
    const hunter = await domainSearch(domain)
    if (hunter.error) result.errors.push(hunter.error)
    hunterPattern = hunter.pattern
    hunterEmails = hunter.emails
    if (hunter.acceptAll !== null) result.catchAll = hunter.acceptAll
    for (const h of hunterEmails) {
      const role = h.position ? classifyRole(h.position) : h.department === 'hr' ? 'hr' : 'other'
      const name = [h.firstName, h.lastName].filter(Boolean).join(' ')
      contacts.push({
        ...base, email: h.email, name, firstName: h.firstName, lastName: h.lastName,
        title: h.position || (h.department ? `${h.department} (Hunter)` : ''), role, source: 'hunter',
        confidence: Math.max(0, Math.min(100, h.confidence)), verification: mapHunterStatus(h.verificationStatus),
      })
      if (h.firstName && h.lastName) {
        const key = `${normalizeNamePart(h.firstName)}|${normalizeNamePart(h.lastName)}`
        if (!personEmail.has(key)) personEmail.set(key, h.email)
      }
    }
  }

  // 4. Company email pattern: observed on the site beats Hunter's
  const observed = inferPattern(knownForPattern)
  if (observed) {
    result.pattern = observed
    result.patternSource = 'observed'
  } else if (hunterPattern) {
    result.pattern = hunterPattern
    result.patternSource = 'hunter'
  }

  // 5. People without an email: build one from the pattern, Hunter, or confirmed guesses
  const unconfirmedCandidates = new Set<string>() // only kept if verification confirms them
  if (options.guessPatterns) {
    let finderCalls = 0
    let guessedPeople = 0
    for (const [key, person] of people) {
      if (personEmail.has(key) || !wantRole(person.role)) continue
      const personBase = {
        ...base, name: person.name, firstName: person.firstName, lastName: person.lastName,
        title: person.title, role: person.role, sourceUrl: person.sourceUrl,
      }
      if (result.pattern) {
        const local = applyPattern(result.pattern, person.firstName, person.lastName)
        if (local) {
          contacts.push({ ...personBase, email: `${local}@${domain}`, source: 'pattern', confidence: result.patternSource === 'observed' ? 60 : 50 })
        }
      } else if (isHunterEnabled() && finderCalls < 5 && Date.now() < options.deadline - 4000) {
        finderCalls++
        const found = await emailFinder(domain, person.firstName, person.lastName)
        if (found.error) result.errors.push(found.error)
        if (found.email) {
          contacts.push({ ...personBase, email: found.email, source: 'hunter', confidence: Math.min(100, found.score), verification: mapHunterStatus(found.verificationStatus) })
        }
      } else if (options.verify && guessedPeople < 10) {
        // No known pattern: try the 3 most common and keep only confirmed mailboxes
        guessedPeople++
        for (const pattern of PATTERNS.slice(0, 3)) {
          const local = applyPattern(pattern, person.firstName, person.lastName)
          if (!local) continue
          const email = `${local}@${domain}`
          unconfirmedCandidates.add(email)
          contacts.push({ ...personBase, email, source: 'pattern', confidence: 40 })
        }
      }
    }
  }

  // 6. Verify
  let verifications = new Map<string, VerificationResult>()
  if (options.verify && contacts.length > 0) {
    const emails = [...new Set(contacts.map((c) => c.email))]
    const { value, timedOut } = await withDeadline(verifyEmailsBatch(emails, 10), options.deadline, new Map<string, VerificationResult>())
    verifications = value
    if (timedOut) {
      truncated = true
      result.errors.push('Verification ran out of time — some addresses are unverified')
    }
    for (const v of verifications.values()) {
      if (isConfirmed(v)) result.catchAll = result.catchAll ?? false
      if (isCatchAll(v)) result.catchAll = true
    }
  }

  const finalContacts: Contact[] = []
  for (const contact of contacts) {
    const v = verifications.get(contact.email)
    const confirmed = isConfirmed(v)

    if (contact.source === 'pattern') {
      if (unconfirmedCandidates.has(contact.email) && !confirmed) continue // drop unconfirmed blind guesses
      if (v?.status === 'invalid') continue // wrong guess
      if (v) {
        contact.verification = confirmed
          ? { status: 'safe' }
          : { status: 'risky', reason: isCatchAll(v) ? `${GUESS_REASON} (catch-all domain)` : GUESS_REASON }
      } else {
        contact.verification = { status: 'risky', reason: GUESS_REASON }
      }
    } else if (contact.source === 'hunter') {
      if (v?.status === 'invalid') contact.verification = { status: 'invalid', reason: v.reason }
      else if (!contact.verification && v) contact.verification = { status: v.status, reason: v.reason }
    } else if (v) {
      contact.verification = { status: v.status, reason: v.reason }
    }

    if (confirmed) contact.confidence = Math.min(100, contact.confidence + 10)
    finalContacts.push(contact)
  }

  result.peopleFound = people.size

  return { contacts: dedupeAndSort(finalContacts.filter((c) => wantRole(c.role))), company: result, truncated }
}

export function dedupeAndSort(contacts: Contact[]): Contact[] {
  const byEmail = new Map<string, Contact>()
  for (const contact of contacts) {
    const key = contact.email.toLowerCase()
    const existing = byEmail.get(key)
    if (!existing) {
      byEmail.set(key, { ...contact, email: key })
      continue
    }
    const preferNew = SOURCE_RANK[contact.source] > SOURCE_RANK[existing.source]
    const winner = preferNew ? { ...contact, email: key } : existing
    const loser = preferNew ? existing : contact
    // Keep the best title / name from either record
    if ((!winner.title || winner.role === 'other') && loser.title && loser.role !== 'other') {
      winner.title = loser.title
      winner.role = loser.role
    }
    if (!winner.name && loser.name) {
      winner.name = loser.name
      winner.firstName = loser.firstName
      winner.lastName = loser.lastName
    }
    winner.confidence = Math.max(winner.confidence, loser.confidence)
    winner.verification = winner.verification || loser.verification
    byEmail.set(key, winner)
  }
  return [...byEmail.values()].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.confidence - a.confidence
  )
}
