import { fetchJson, isRemoteText, snippet, str, toIso, type Job } from './types'

const base = () => (process.env.JOBS_ASHBY_BASE || 'https://api.ashbyhq.com').replace(/\/$/, '')

export function parseAshbyJobs(data: unknown, boardName: string, company: string): Job[] {
  const jobs = (data as { jobs?: unknown[] })?.jobs
  if (!Array.isArray(jobs)) return []
  return jobs.flatMap((raw): Job[] => {
    const j = raw as Record<string, any>
    const title = str(j?.title).trim()
    if (!title || j.isListed === false) return []
    const location = str(j.location) || str(j.address?.postalAddress?.addressLocality)
    return [{
      id: str(j.id) || str(j.jobUrl) || title,
      provider: 'ashby',
      company,
      boardToken: boardName,
      title,
      url: str(j.jobUrl) || str(j.applyUrl),
      location,
      department: [str(j.department), str(j.team)].filter(Boolean).join(' / '),
      remote: j.isRemote === true || str(j.workplaceType).toLowerCase() === 'remote' || isRemoteText(location, title),
      postedAt: toIso(j.publishedAt),
      descriptionSnippet: snippet(str(j.descriptionPlain)),
    }]
  })
}

export async function fetchAshbyJobs(boardName: string, company = boardName): Promise<Job[] | null> {
  const { status, data } = await fetchJson(
    `${base()}/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=true`
  )
  if (status === 404 || data === null) return null
  if (!Array.isArray((data as { jobs?: unknown }).jobs)) return null
  return parseAshbyJobs(data, boardName, company)
}
