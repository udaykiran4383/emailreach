import { fetchJson, isRemoteText, snippet, str, toIso, type Job } from './types'

const base = () => (process.env.JOBS_LEVER_BASE || 'https://api.lever.co').replace(/\/$/, '')

export function parseLeverJobs(data: unknown, site: string, company: string): Job[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((raw): Job[] => {
    const j = raw as Record<string, any>
    const title = str(j?.text).trim()
    if (!title) return []
    const categories = j.categories || {}
    const location = str(categories.location) || (Array.isArray(categories.allLocations) ? categories.allLocations.join(', ') : '')
    const workplace = str(j.workplaceType)
    return [{
      id: str(j.id) || title,
      provider: 'lever',
      company,
      boardToken: site,
      title,
      url: str(j.hostedUrl) || str(j.applyUrl),
      location,
      department: [str(categories.department), str(categories.team)].filter(Boolean).join(' / '),
      remote: workplace === 'remote' || isRemoteText(location, title, str(categories.commitment)),
      postedAt: toIso(j.createdAt),
      descriptionSnippet: snippet(str(j.descriptionPlain) || str(j.openingPlain)),
    }]
  })
}

export async function fetchLeverJobs(site: string, company = site): Promise<Job[] | null> {
  const { status, data } = await fetchJson(`${base()}/v0/postings/${encodeURIComponent(site)}?mode=json`)
  if (status === 404 || data === null) return null
  // Lever answers unknown sites with 404 or an error object; only an array is a real board
  if (!Array.isArray(data)) return null
  return parseLeverJobs(data, site, company)
}
