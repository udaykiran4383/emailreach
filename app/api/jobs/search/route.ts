import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { detectAndFetchJobs, rankJobs, type JobProvider, type ScoredJob, type Seniority } from '@/lib/jobs'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const MAX_COMPANIES = 5
const TIME_BUDGET_MS = 20_000
const MAX_JOBS_PER_COMPANY = 50
const SENIORITIES: Seniority[] = ['intern', 'new_grad', 'junior', 'mid', 'senior']

export interface JobSearchResult {
  company: string
  domain: string
  provider: JobProvider | null
  boardToken: string | null
  totalJobs: number
  jobs: ScoredJob[]
  error?: string
}

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = rateLimit(user.id, 'jobs-search')
  if (limited) return limited

  let body: { companies?: unknown; keywords?: unknown; seniority?: unknown; remoteOnly?: unknown; location?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const companies = Array.isArray(body.companies)
    ? [...new Set(body.companies.map((c) => String(c).trim()).filter(Boolean))]
    : []
  if (companies.length === 0) {
    return NextResponse.json({ error: 'Provide at least one company domain' }, { status: 400 })
  }
  if (companies.length > MAX_COMPANIES) {
    return NextResponse.json({ error: `Too many companies (max ${MAX_COMPANIES} per request)` }, { status: 400 })
  }

  const options = {
    keywords: typeof body.keywords === 'string' ? body.keywords.slice(0, 500) : '',
    seniority: Array.isArray(body.seniority)
      ? body.seniority.filter((s): s is Seniority => SENIORITIES.includes(s as Seniority))
      : [],
    remoteOnly: body.remoteOnly === true,
    location: typeof body.location === 'string' ? body.location.slice(0, 100) : '',
  }

  const deadline = Date.now() + TIME_BUDGET_MS
  const results: JobSearchResult[] = []
  let truncated = false

  for (const company of companies) {
    if (Date.now() > deadline - 2000) {
      truncated = true
      break
    }
    // Split what's left of the budget across the remaining companies
    const remaining = companies.length - results.length
    const companyDeadline = Date.now() + (deadline - Date.now()) / remaining
    try {
      const found = await detectAndFetchJobs(company, companyDeadline)
      const jobs = rankJobs(found.jobs, options).slice(0, MAX_JOBS_PER_COMPANY)
      results.push({
        company: found.company,
        domain: found.domain,
        provider: found.board?.provider ?? null,
        boardToken: found.board?.boardToken ?? null,
        totalJobs: found.jobs.length,
        jobs,
        error: found.error,
      })
    } catch (err) {
      results.push({
        company,
        domain: company,
        provider: null,
        boardToken: null,
        totalJobs: 0,
        jobs: [],
        error: err instanceof Error ? err.message : 'Job search failed',
      })
    }
  }

  results.sort((a, b) => (b.jobs[0]?.score ?? -1) - (a.jobs[0]?.score ?? -1))
  return NextResponse.json({ results, truncated })
}
