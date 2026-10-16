import { privateFetchAllowedForTests, resolvePublicAddress, safeRequest } from '@/lib/net/safe-request'

export interface ExtractedEmail {
  email: string
  name: string
  company: string
  source: string
}

export interface UrlExtractionResult {
  emails: ExtractedEmail[]
  pagesFetched: number
  errors: string[]
}

const EMAIL_REGEX = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}/gi
const STRICT_EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/

const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'ico', 'bmp', 'tiff', 'avif', 'mp4', 'webm', 'woff', 'woff2', 'ttf', 'pdf', 'json', 'xml'])

const JUNK_DOMAINS = [
  'example.com', 'example.org', 'example.net', 'sentry.io', 'wixpress.com', 'sentry-next.wixpress.com',
  'sentry.wixpress.com', 'domain.com', 'email.com', 'yourdomain.com', 'yourcompany.com', 'company.com',
  'test.com', 'localhost', 'mysite.com', 'website.com', 'sentry-cdn.com', 'ingest.sentry.io',
]

const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
  'proton.me', 'pm.me', 'rediffmail.com', 'zoho.com', 'zohomail.in', 'gmx.com', 'gmx.de', 'mail.com',
  'yandex.com', 'yandex.ru', 'tutanota.com', 'fastmail.com', 'hey.com', 'qq.com', '163.com',
])

const ROLE_PREFIXES = new Set([
  'info', 'hr', 'careers', 'career', 'jobs', 'job', 'contact', 'hello', 'hi', 'support', 'help', 'admin',
  'sales', 'marketing', 'office', 'team', 'press', 'media', 'recruitment', 'recruiting', 'talent', 'hiring',
  'enquiry', 'enquiries', 'inquiry', 'inquiries', 'mail', 'email', 'webmaster', 'noreply', 'no-reply',
  'privacy', 'legal', 'billing', 'accounts', 'feedback', 'partners', 'partnerships', 'founders', 'people',
])

// Second-level labels that are part of a public suffix (acme.co.in, acme.com.au, ...)
const SUFFIX_LABELS = new Set(['co', 'com', 'org', 'net', 'ac', 'edu', 'gov', 'ltd', 'plc', 'gen', 'firm', 'ind', 'res'])

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
}

/** Cloudflare "email protection" obfuscation: first byte is the XOR key. */
function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  }
  return out
}

function deobfuscate(text: string): string {
  return text
    // name [at] domain [dot] com, name (at) domain (dot) com, name {at} domain {dot} com
    .replace(/\s*[\[\(\{<]\s*at\s*[\]\)\}>]\s*/gi, '@')
    .replace(/\s*[\[\(\{<]\s*dot\s*[\]\)\}>]\s*/gi, '.')
}

/** " at " / " dot " forms are only accepted when they produce a valid address. */
function extractSpacedObfuscations(text: string): string[] {
  const results: string[] = []
  const re = /([a-z0-9][a-z0-9._%+-]{0,63})\s+(?:at|AT)\s+([a-z0-9-]+(?:\s+(?:dot|DOT)\s+[a-z0-9-]+)+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const candidate = `${m[1]}@${m[2].replace(/\s+(?:dot|DOT)\s+/g, '.')}`.toLowerCase()
    if (STRICT_EMAIL.test(candidate)) results.push(candidate)
  }
  return results
}

function isJunk(email: string): boolean {
  const [local, domain] = email.split('@')
  if (!local || !domain) return true
  if (local.length > 64) return true
  if (email.includes('@2x') || /@\dx\./.test(email)) return true
  if (local.startsWith('u003e') || local.startsWith('u003c') || local.includes('%')) return true
  if (/^[0-9a-f]{24,}$/.test(local)) return true
  const tld = domain.split('.').pop() || ''
  if (ASSET_TLDS.has(tld)) return true
  if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true
  if (!STRICT_EMAIL.test(email)) return true
  return false
}

export function guessNameFromEmail(email: string): string {
  const local = email.split('@')[0].split('+')[0]
  if (ROLE_PREFIXES.has(local)) return ''
  const parts = local
    .replace(/[0-9]/g, ' ')
    .split(/[._\-\s]+/)
    .filter((s) => s.length > 1)
  if (parts.length === 0 || parts.some((p) => ROLE_PREFIXES.has(p))) return ''
  return parts.map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ')
}

export function guessCompanyFromEmail(email: string): string {
  const domain = email.split('@')[1] || ''
  if (FREE_PROVIDERS.has(domain)) return ''
  const labels = domain.split('.')
  if (labels.length < 2) return ''
  labels.pop() // tld
  if (labels.length > 1 && SUFFIX_LABELS.has(labels[labels.length - 1])) labels.pop()
  const main = labels[labels.length - 1]
  if (!main) return ''
  return main
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function extractEmailsFromText(text: string, source = 'text'): ExtractedEmail[] {
  if (!text) return []
  const found: string[] = []

  // Cloudflare-protected addresses
  for (const m of text.matchAll(/data-cfemail=["']?([0-9a-f]+)/gi)) {
    const decoded = decodeCfEmail(m[1])
    if (decoded) found.push(decoded)
  }
  for (const m of text.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const decoded = decodeCfEmail(m[1])
    if (decoded) found.push(decoded)
  }

  let normalized = decodeHtmlEntities(text)
  // mailto: links (percent-encoded, with ?subject=...)
  for (const m of normalized.matchAll(/mailto:([^"'\s>?]+)/gi)) {
    try {
      found.push(decodeURIComponent(m[1]))
    } catch {
      found.push(m[1].replace(/%40/gi, '@'))
    }
  }

  normalized = deobfuscate(normalized)
  found.push(...(normalized.match(EMAIL_REGEX) || []))
  found.push(...extractSpacedObfuscations(normalized))

  const seen = new Set<string>()
  const results: ExtractedEmail[] = []
  for (const raw of found) {
    const email = raw.trim().toLowerCase().replace(/^[.\-_]+|[.\-_]+$/g, '')
    if (seen.has(email) || isJunk(email)) continue
    seen.add(email)
    results.push({ email, name: guessNameFromEmail(email), company: guessCompanyFromEmail(email), source })
  }
  return results
}

// ---------------------------------------------------------------------------
// URL fetching with SSRF protection
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const CRAWL_PATTERN = /contact|about|team|people|staff|faculty|careers|jobs|imprint|leadership|founders/i

/** Throws for non-http(s) URLs and private/internal hosts. */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http/https URLs are allowed')
  if (privateFetchAllowedForTests()) return
  await resolvePublicAddress(url)
}

/** Fetches a public page, following up to 3 redirects and re-validating each hop. */
export async function fetchPublicPage(rawUrl: string): Promise<{ url: string; body: string }> {
  let url = new URL(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // safeRequest validates the host and pins the connection to the validated address
    const res = await safeRequest(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers['location']
      if (!location) throw new Error(`Redirect without location (${res.status})`)
      url = new URL(location, url)
      continue
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
    const type = res.headers['content-type'] || ''
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      throw new Error(`Unsupported content type: ${type.split(';')[0]}`)
    }
    return { url: url.toString(), body: res.body }
  }
  throw new Error('Too many redirects')
}

function findCrawlLinks(html: string, base: URL): string[] {
  const links = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]
    const text = m[2].replace(/<[^>]+>/g, ' ')
    if (/^(mailto|tel|javascript):/i.test(href)) continue
    let target: URL
    try {
      target = new URL(href, base)
    } catch {
      continue
    }
    if (target.hostname !== base.hostname) continue
    if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?|mp4)$/i.test(target.pathname)) continue
    if (CRAWL_PATTERN.test(target.pathname) || CRAWL_PATTERN.test(text)) {
      target.hash = ''
      links.add(target.toString())
    }
  }
  return [...links]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function extractEmailsFromUrl(
  rawUrl: string,
  { crawl = false, maxPages = 6, deadline }: { crawl?: boolean; maxPages?: number; deadline?: number } = {}
): Promise<UrlExtractionResult> {
  const errors: string[] = []
  const emails: ExtractedEmail[] = []
  const seenEmails = new Set<string>()
  let pagesFetched = 0

  let start: URL
  try {
    start = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { emails, pagesFetched, errors: [`Invalid URL: ${rawUrl}`] }
  }

  const queue: string[] = [start.toString()]
  const visited = new Set<string>()

  while (queue.length > 0 && pagesFetched < maxPages) {
    if (deadline && Date.now() > deadline) {
      errors.push(`${start.hostname}: stopped early (time limit)`)
      break
    }
    const next = queue.shift()!
    if (visited.has(next)) continue
    visited.add(next)
    if (pagesFetched > 0) await sleep(300)

    try {
      const page = await fetchPublicPage(next)
      pagesFetched++
      for (const e of extractEmailsFromText(page.body, page.url)) {
        if (!seenEmails.has(e.email)) {
          seenEmails.add(e.email)
          emails.push(e)
        }
      }
      if (crawl && pagesFetched === 1) {
        const finalUrl = new URL(page.url)
        for (const link of findCrawlLinks(page.body, finalUrl)) {
          if (!visited.has(link)) queue.push(link)
        }
      }
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'timed out' : err?.message || 'fetch failed'
      errors.push(`${next}: ${reason}`)
    }
  }

  return { emails, pagesFetched, errors }
}
