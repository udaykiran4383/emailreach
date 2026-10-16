/**
 * Optional Hunter.io lookups (only used when HUNTER_API_KEY is set).
 * Never throws: failures are returned as an error string.
 */

const API_BASE = 'https://api.hunter.io/v2'
const TIMEOUT_MS = 8000

export interface HunterEmail {
  email: string
  firstName: string
  lastName: string
  position: string
  department: string
  seniority: string
  confidence: number
  verificationStatus: string | null // valid | accept_all | invalid | unknown | null
}

export interface HunterDomainResult {
  emails: HunterEmail[]
  pattern: string | null
  acceptAll: boolean | null
  error?: string
}

export function isHunterEnabled(): boolean {
  return !!process.env.HUNTER_API_KEY
}

async function hunterGet(path: string, params: Record<string, string>): Promise<{ json?: any; error?: string }> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return { error: 'HUNTER_API_KEY not set' }
  const query = new URLSearchParams({ ...params, api_key: key })
  try {
    const res = await fetch(`${API_BASE}${path}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    const json: any = await res.json().catch(() => null)
    if (!res.ok) {
      const detail = json?.errors?.[0]?.details || json?.errors?.[0]?.id || `HTTP ${res.status}`
      return { error: `Hunter: ${detail}` }
    }
    return { json }
  } catch (error: any) {
    return { error: `Hunter: ${error?.name === 'TimeoutError' ? 'timeout' : error?.message || 'request failed'}` }
  }
}

export async function domainSearch(
  domain: string,
  { departments = ['executive', 'it', 'hr'], seniority }: { departments?: string[]; seniority?: string } = {}
): Promise<HunterDomainResult> {
  const params: Record<string, string> = { domain, limit: '25' }
  if (departments.length) params.department = departments.join(',')
  if (seniority) params.seniority = seniority

  const { json, error } = await hunterGet('/domain-search', params)
  if (error || !json?.data) return { emails: [], pattern: null, acceptAll: null, error: error || 'Hunter: empty response' }

  const data = json.data
  const emails: HunterEmail[] = (Array.isArray(data.emails) ? data.emails : [])
    .filter((e: any) => typeof e?.value === 'string' && e.value.includes('@'))
    .map((e: any) => ({
      email: String(e.value).toLowerCase(),
      firstName: String(e.first_name || ''),
      lastName: String(e.last_name || ''),
      position: String(e.position || ''),
      department: String(e.department || ''),
      seniority: String(e.seniority || ''),
      confidence: Number.isFinite(e.confidence) ? Number(e.confidence) : 50,
      verificationStatus: e.verification?.status ? String(e.verification.status) : null,
    }))

  return {
    emails,
    pattern: typeof data.pattern === 'string' && data.pattern ? data.pattern : null,
    acceptAll: typeof data.accept_all === 'boolean' ? data.accept_all : null,
  }
}

export async function emailFinder(
  domain: string,
  firstName: string,
  lastName: string
): Promise<{ email: string | null; score: number; verificationStatus: string | null; error?: string }> {
  const { json, error } = await hunterGet('/email-finder', { domain, first_name: firstName, last_name: lastName })
  if (error || !json?.data) return { email: null, score: 0, verificationStatus: null, error: error || 'Hunter: empty response' }
  const data = json.data
  return {
    email: typeof data.email === 'string' && data.email ? data.email.toLowerCase() : null,
    score: Number.isFinite(data.score) ? Number(data.score) : 0,
    verificationStatus: data.verification?.status ? String(data.verification.status) : null,
  }
}
