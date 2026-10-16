import { fetchJson, htmlToText, isRemoteText, snippet, str, toIso, type Job } from './types'

const base = () => (process.env.JOBS_GREENHOUSE_BASE || 'https://boards-api.greenhouse.io').replace(/\/$/, '')

export function parseGreenhouseJobs(data: unknown, boardToken: string, company: string): Job[] {
  const jobs = (data as { jobs?: unknown[] })?.jobs
  if (!Array.isArray(jobs)) return []
  return jobs.flatMap((raw): Job[] => {
    const j = raw as Record<string, any>
    const title = str(j?.title).trim()
    if (!title) return []
    const location = str(j.location?.name)
    const department = Array.isArray(j.departments) ? j.departments.map((d: any) => str(d?.name)).filter(Boolean).join(', ') : ''
    const description = htmlToText(str(j.content))
    return [{
      id: str(j.id) || str(j.internal_job_id) || title,
      provider: 'greenhouse',
      company,
      boardToken,
      title,
      url: str(j.absolute_url),
      location,
      department,
      remote: isRemoteText(location, title),
      postedAt: toIso(j.updated_at ?? j.first_published),
      descriptionSnippet: snippet(description),
    }]
  })
}

/** Returns null when the board doesn't exist (404). */
export async function fetchGreenhouseJobs(boardToken: string, company = boardToken): Promise<Job[] | null> {
  const { status, data } = await fetchJson(`${base()}/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`)
  if (status === 404 || data === null) return null
  return parseGreenhouseJobs(data, boardToken, company)
}
