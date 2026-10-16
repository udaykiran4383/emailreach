import type { Job, ScoredJob } from './types'

export type Seniority = 'intern' | 'new_grad' | 'junior' | 'mid' | 'senior'

export interface MatchOptions {
  keywords: string
  seniority?: Seniority[]
  remoteOnly?: boolean
  location?: string
}

const SENIORITY_PATTERNS: Record<Seniority, RegExp> = {
  intern: /\b(intern|internship|co-?op|apprentice)\b/i,
  new_grad: /\b(new grad|graduate|university|campus|entry[- ]level|early career|fresher)\b/i,
  junior: /\b(junior|jr\.?|associate|engineer i|sde ?1|sde i|level 1)\b/i,
  senior: /\b(senior|sr\.?|staff|principal|lead|head|director|manager|architect|vp)\b/i,
  mid: /$^/, // anything not matching the others
}

export function detectSeniority(title: string): Seniority {
  for (const level of ['intern', 'new_grad', 'junior', 'senior'] as const) {
    if (SENIORITY_PATTERNS[level].test(title)) return level
  }
  return 'mid'
}

/** Splits "backend engineer, node, react" into keyword phrases. */
export function parseKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[,;\n]+/)
        .flatMap((part) => {
          const phrase = part.trim()
          if (!phrase) return []
          // Keep the whole phrase plus its meaningful words
          const words = phrase.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w))
          return words.length > 1 ? [phrase, ...words] : words
        })
    ),
  ]
}

const STOP_WORDS = new Set(['and', 'or', 'the', 'of', 'in', 'a', 'an', 'for', 'to', 'with', 'at'])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsTerm(haystack: string, term: string): boolean {
  // Word-boundary match that still works for terms like "c++", "node.js", ".net"
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, 'i').test(haystack)
}

/**
 * Scores a job 0-100 against keywords. Title hits weigh much more than description hits.
 * Returns null when the job is filtered out (seniority / remote / location).
 */
export function scoreJob(job: Job, options: MatchOptions): number | null {
  if (options.remoteOnly && !job.remote) return null
  if (options.location?.trim()) {
    const loc = options.location.trim().toLowerCase()
    const where = `${job.location} ${job.remote ? 'remote' : ''}`.toLowerCase()
    if (!where.includes(loc)) return null
  }
  if (options.seniority?.length && !options.seniority.includes(detectSeniority(job.title))) return null

  const terms = parseKeywords(options.keywords)
  if (terms.length === 0) return 50

  const title = job.title.toLowerCase()
  const context = `${job.department} ${job.descriptionSnippet}`.toLowerCase()
  let points = 0
  let max = 0
  for (const term of terms) {
    const weight = term.includes(' ') ? 2 : 1 // full phrases count double
    max += 3 * weight
    if (containsTerm(title, term)) points += 3 * weight
    else if (containsTerm(context, term)) points += 1 * weight
  }
  const score = Math.round((points / max) * 100)
  // Any title hit guarantees a visible score so strong matches don't get buried by long keyword lists
  return terms.some((t) => containsTerm(title, t)) ? Math.max(score, 40) : score
}

export function rankJobs(jobs: Job[], options: MatchOptions, minScore = 1): ScoredJob[] {
  return jobs
    .flatMap((job) => {
      const score = scoreJob(job, options)
      return score === null || score < minScore ? [] : [{ ...job, score }]
    })
    .sort((a, b) => b.score - a.score || (b.postedAt || '').localeCompare(a.postedAt || ''))
}
