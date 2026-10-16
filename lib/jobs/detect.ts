import { fetchPublicPage } from '@/lib/email/extractor'
import { normalizeCompanyInput } from '@/lib/email/people-finder'
import { fetchAshbyJobs } from './ashby'
import { fetchGreenhouseJobs } from './greenhouse'
import { fetchLeverJobs } from './lever'
import type { BoardRef, Job, JobProvider } from './types'

const CACHE_TTL_MS = 60 * 60 * 1000
const boardCache = new Map<string, { board: BoardRef | null; expires: number }>()

const BOARD_LINK_PATTERNS: Array<{ provider: JobProvider; re: RegExp }> = [
  { provider: 'greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { provider: 'greenhouse', re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { provider: 'lever', re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/i },
  { provider: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i },
]

// Path segments on board hosts that are not company tokens
const NON_TOKENS = new Set(['embed', 'v1', 'api', 'static', 'assets', 'js', 'css', 'favicon.ico'])

/** Finds an ATS board link in page HTML. Pure — exported for tests. */
export function findBoardInHtml(html: string): BoardRef | null {
  for (const { provider, re } of BOARD_LINK_PATTERNS) {
    const global = new RegExp(re.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = global.exec(html))) {
      const token = decodeURIComponent(m[1]).replace(/[.\-_]+$/, '')
      if (token && !NON_TOKENS.has(token.toLowerCase())) return { provider, boardToken: token }
    }
  }
  return null
}

/** Candidate board tokens from a domain: acme-labs.io → ['acmelabs', 'acme-labs', 'acme']. */
export function guessTokens(domain: string): string[] {
  const label = domain.split('.')[0].toLowerCase()
  return [...new Set([label.replace(/[^a-z0-9]/g, ''), label, label.split('-')[0]].filter(Boolean))]
}

export function companyNameFromDomain(domain: string): string {
  return domain
    .split('.')[0]
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function fetchBoardJobs(board: BoardRef, company: string): Promise<Job[] | null> {
  switch (board.provider) {
    case 'greenhouse':
      return fetchGreenhouseJobs(board.boardToken, company)
    case 'lever':
      return fetchLeverJobs(board.boardToken, company)
    case 'ashby':
      return fetchAshbyJobs(board.boardToken, company)
  }
}

export interface DetectResult {
  domain: string
  company: string
  board: BoardRef | null
  jobs: Job[]
  error?: string
}

/**
 * Finds a company's public job board and returns its jobs.
 * 1) careers links on the company site, 2) probe tokens guessed from the domain.
 */
export async function detectAndFetchJobs(input: string, deadline = Date.now() + 15_000): Promise<DetectResult> {
  const normalized = normalizeCompanyInput(input)
  if ('error' in normalized) {
    return { domain: input, company: input, board: null, jobs: [], error: normalized.error }
  }
  const { domain, homepage } = normalized
  const company = companyNameFromDomain(domain)

  const cached = boardCache.get(domain)
  if (cached && cached.expires > Date.now()) {
    if (!cached.board) return { domain, company, board: null, jobs: [], error: 'No public Greenhouse, Lever or Ashby board found' }
    const jobs = await fetchBoardJobs(cached.board, company)
    if (jobs) return { domain, company, board: cached.board, jobs }
  }

  const remember = (board: BoardRef | null) => boardCache.set(domain, { board, expires: Date.now() + CACHE_TTL_MS })

  // 1. Careers pages on the company site
  const origin = new URL(homepage).origin
  for (const path of ['', '/careers', '/jobs']) {
    if (Date.now() > deadline - 4000) break
    try {
      const page = await fetchPublicPage(`${origin}${path}`)
      const board = findBoardInHtml(page.body)
      if (board) {
        const jobs = await fetchBoardJobs(board, company)
        if (jobs) {
          remember(board)
          return { domain, company, board, jobs }
        }
      }
    } catch {
      // Missing /careers page etc. — try the next one
    }
  }

  // 2. Probe tokens guessed from the domain on each provider
  for (const token of guessTokens(domain)) {
    for (const provider of ['greenhouse', 'lever', 'ashby'] as const) {
      if (Date.now() > deadline - 1000) {
        return { domain, company, board: null, jobs: [], error: 'Timed out looking for a job board' }
      }
      try {
        const board = { provider, boardToken: token }
        const jobs = await fetchBoardJobs(board, company)
        if (jobs) {
          remember(board)
          return { domain, company, board, jobs }
        }
      } catch {
        // Network error on one provider shouldn't stop the others
      }
    }
  }

  remember(null)
  return { domain, company, board: null, jobs: [], error: 'No public Greenhouse, Lever or Ashby board found' }
}
