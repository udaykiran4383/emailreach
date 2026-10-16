import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { extractEmailsFromText, extractEmailsFromUrl, ExtractedEmail } from '@/lib/email/extractor'
import { verifyEmailsBatch } from '@/lib/email/verifier'
import { rateLimit } from '@/lib/rate-limit'

const MAX_TEXT_BYTES = 500 * 1024
const MAX_URLS = 20
const TIME_BUDGET_MS = 25_000
const MAX_VERIFY = 300

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = rateLimit(user.id, 'extract')
  if (limited) return limited

  let body: { text?: string; urls?: string[]; crawl?: boolean; verify?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text : ''
  const urls = Array.isArray(body.urls)
    ? body.urls.map((u) => String(u).trim()).filter(Boolean)
    : []

  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    return NextResponse.json({ error: 'Text is too large (max 500KB)' }, { status: 400 })
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json({ error: `Too many URLs (max ${MAX_URLS})` }, { status: 400 })
  }
  if (!text && urls.length === 0) {
    return NextResponse.json({ error: 'Provide text or at least one URL' }, { status: 400 })
  }

  const startedAt = Date.now()
  // Leave room for verification after fetching pages
  const fetchDeadline = startedAt + (body.verify ? TIME_BUDGET_MS * 0.6 : TIME_BUDGET_MS)
  const errors: string[] = []
  let pagesFetched = 0
  let truncated = false

  const merged = new Map<string, ExtractedEmail>()
  const addAll = (list: ExtractedEmail[]) => {
    for (const e of list) if (!merged.has(e.email)) merged.set(e.email, e)
  }

  if (text) addAll(extractEmailsFromText(text, 'pasted text'))

  for (const url of urls) {
    if (Date.now() > fetchDeadline) {
      truncated = true
      errors.push(`Skipped ${url}: time limit reached`)
      continue
    }
    const result = await extractEmailsFromUrl(url, { crawl: !!body.crawl, deadline: fetchDeadline })
    pagesFetched += result.pagesFetched
    errors.push(...result.errors)
    addAll(result.emails)
  }

  let emails: Array<ExtractedEmail & { verification?: { status: string; reason?: string } }> = [...merged.values()]

  if (body.verify && emails.length > 0) {
    const toVerify = emails.slice(0, MAX_VERIFY).map((e) => e.email)
    if (emails.length > MAX_VERIFY) {
      truncated = true
      errors.push(`Only the first ${MAX_VERIFY} addresses were verified`)
    }
    try {
      const remaining = TIME_BUDGET_MS - (Date.now() - startedAt)
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(remaining, 3000)))
      const results = await Promise.race([verifyEmailsBatch(toVerify, 10), timeout])
      if (!results) {
        truncated = true
        errors.push('Verification timed out; unverified addresses are marked as unknown')
      }
      emails = emails.map((e) => {
        const v = results?.get(e.email)
        return v ? { ...e, verification: { status: v.status, reason: v.reason } } : e
      })
    } catch (err: any) {
      errors.push(`Verification failed: ${err?.message || 'unknown error'}`)
    }
  }

  return NextResponse.json({ emails, pagesFetched, errors, truncated })
}
