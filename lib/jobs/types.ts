export type JobProvider = 'greenhouse' | 'lever' | 'ashby'

export interface Job {
  id: string
  provider: JobProvider
  company: string
  boardToken: string
  title: string
  url: string
  location: string
  department: string
  remote: boolean
  postedAt: string | null
  descriptionSnippet: string
}

export interface ScoredJob extends Job {
  score: number
}

export interface BoardRef {
  provider: JobProvider
  boardToken: string
}

export const FETCH_TIMEOUT_MS = 8000
const SNIPPET_LENGTH = 600

export async function fetchJson(url: string): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'EmailReach-JobSearch/1.0' },
    })
    if (!res.ok) return { status: res.status, data: null }
    return { status: res.status, data: await res.json().catch(() => null) }
  } finally {
    clearTimeout(timer)
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

export function htmlToText(html: string): string {
  // Greenhouse returns HTML that is itself entity-encoded, so decode before and after stripping tags
  return decodeEntities(decodeEntities(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function snippet(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH)}…` : clean
}

export function isRemoteText(...parts: string[]): boolean {
  return parts.some((p) => /\bremote\b/i.test(p))
}

export function toIso(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value).toISOString()
  if (typeof value === 'string' && value) {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}
