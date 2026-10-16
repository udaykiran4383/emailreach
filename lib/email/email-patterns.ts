/**
 * Company email address patterns ({first}.{last}@company.com etc.)
 */

// Ordered by how common they are at companies
export const PATTERNS = [
  '{first}.{last}',
  '{first}',
  '{f}{last}',
  '{first}{last}',
  '{first}_{last}',
  '{f}.{last}',
  '{last}',
  '{first}{l}',
  '{last}.{first}',
] as const

/** Lowercase, strip diacritics (José -> jose) and anything that is not a-z0-9. */
export function normalizeNamePart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Builds the local part for a pattern, or null if a needed name part is missing. */
export function applyPattern(pattern: string, first: string, last: string): string | null {
  const f = normalizeNamePart(first)
  const l = normalizeNamePart(last)
  if (pattern.includes('{first}') || pattern.includes('{f}')) {
    if (!f) return null
  }
  if (pattern.includes('{last}') || pattern.includes('{l}')) {
    if (!l) return null
  }
  const local = pattern
    .replace(/\{first\}/g, f)
    .replace(/\{last\}/g, l)
    .replace(/\{f\}/g, f.charAt(0))
    .replace(/\{l\}/g, l.charAt(0))
  return local || null
}

/**
 * Picks the pattern that explains the most known (email, name) pairs.
 * Patterns that only use the first name need two matches, since "{first}"
 * also fits one-off aliases like founder@ addresses that happen to be a name.
 */
export function inferPattern(knownEmails: { email: string; first: string; last: string }[]): string | null {
  const scores = new Map<string, number>()
  for (const known of knownEmails) {
    const local = known.email.toLowerCase().split('@')[0]
    for (const pattern of PATTERNS) {
      if (applyPattern(pattern, known.first, known.last) === local) {
        scores.set(pattern, (scores.get(pattern) || 0) + 1)
      }
    }
  }
  let best: string | null = null
  let bestScore = 0
  for (const pattern of PATTERNS) {
    const score = scores.get(pattern) || 0
    const needed = pattern === '{first}' || pattern === '{last}' ? 2 : 1
    if (score >= needed && score > bestScore) {
      best = pattern
      bestScore = score
    }
  }
  return best
}
