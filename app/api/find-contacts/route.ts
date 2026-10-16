import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { ALL_ROLES, dedupeAndSort, findCompanyContacts, type CompanyResult, type Contact, type Role } from '@/lib/email/people-finder'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const MAX_COMPANIES = 3
const TIME_BUDGET_MS = 20_000

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = rateLimit(user.id, 'find-contacts')
  if (limited) return limited

  let body: { companies?: unknown; roles?: unknown; verify?: unknown; guessPatterns?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const companies = Array.isArray(body.companies)
    ? [...new Set(body.companies.map((c) => String(c).trim()).filter(Boolean))]
    : []
  if (companies.length === 0) {
    return NextResponse.json({ error: 'Provide at least one company domain or URL' }, { status: 400 })
  }
  if (companies.length > MAX_COMPANIES) {
    return NextResponse.json({ error: `Too many companies (max ${MAX_COMPANIES} per request)` }, { status: 400 })
  }

  const roles = Array.isArray(body.roles)
    ? body.roles.filter((r): r is Role => ALL_ROLES.includes(r as Role))
    : []
  const verify = body.verify !== false
  const guessPatterns = body.guessPatterns !== false

  const deadline = Date.now() + TIME_BUDGET_MS
  const contacts: Contact[] = []
  const results: CompanyResult[] = []
  let truncated = false

  for (let i = 0; i < companies.length; i++) {
    // Split what's left of the budget evenly across the remaining companies
    const remaining = deadline - Date.now()
    const companyDeadline = Date.now() + Math.floor(remaining / (companies.length - i))
    if (remaining < 3000) {
      truncated = true
      results.push({
        input: companies[i], domain: '', company: '', pattern: null, patternSource: null,
        catchAll: null, pagesFetched: 0, peopleFound: 0, errors: ['Skipped: out of time, search this company again'],
      })
      continue
    }
    try {
      const found = await findCompanyContacts(companies[i], { roles, verify, guessPatterns, deadline: companyDeadline })
      contacts.push(...found.contacts)
      results.push(found.company)
      truncated = truncated || found.truncated
    } catch (error: any) {
      results.push({
        input: companies[i], domain: '', company: '', pattern: null, patternSource: null,
        catchAll: null, pagesFetched: 0, peopleFound: 0, errors: [error?.message || 'Search failed'],
      })
    }
  }

  return NextResponse.json({ contacts: dedupeAndSort(contacts), companies: results, truncated })
}
