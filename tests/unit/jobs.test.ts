import { describe, expect, it } from 'vitest'
import { parseGreenhouseJobs } from '@/lib/jobs/greenhouse'
import { parseLeverJobs } from '@/lib/jobs/lever'
import { parseAshbyJobs } from '@/lib/jobs/ashby'
import { detectSeniority, parseKeywords, rankJobs, scoreJob } from '@/lib/jobs/match'
import { findBoardInHtml, guessTokens } from '@/lib/jobs/detect'

const gh = parseGreenhouseJobs(
  {
    jobs: [
      {
        id: 1,
        title: 'Senior Backend Engineer',
        absolute_url: 'https://x/1',
        location: { name: 'Remote - India' },
        updated_at: '2026-10-01T00:00:00Z',
        departments: [{ name: 'Engineering' }],
        content: '&lt;p&gt;We use Node.js &amp;amp; Postgres&lt;/p&gt;',
      },
      { id: 2, title: '' },
      { bogus: true },
    ],
  },
  'acme',
  'Acme'
)
const lv = parseLeverJobs(
  [
    {
      id: 'l1',
      text: 'Software Engineer Intern',
      hostedUrl: 'https://l/1',
      categories: { location: 'Bengaluru', team: 'Platform', commitment: 'Internship' },
      createdAt: 1760000000000,
      descriptionPlain: 'React and TypeScript',
    },
  ],
  'acme',
  'Acme'
)
const ab = parseAshbyJobs(
  {
    jobs: [
      { id: 'a1', title: 'Frontend Engineer', jobUrl: 'https://a/1', location: 'Remote', isRemote: true, department: 'Eng', publishedAt: '2026-09-01', descriptionPlain: 'react' },
      { title: 'Hidden', isListed: false },
    ],
  },
  'acme',
  'Acme'
)

describe('job board parsers', () => {
  it('parses Greenhouse, skipping junk and decoding double-encoded HTML', () => {
    expect(gh).toHaveLength(1)
    expect(gh[0]).toMatchObject({ remote: true, department: 'Engineering', provider: 'greenhouse' })
    expect(gh[0].descriptionSnippet).toMatch(/Node\.js & Postgres/)
    expect(parseGreenhouseJobs(null, 'a', 'A')).toEqual([])
  })

  it('parses Lever', () => {
    expect(lv[0].title).toBe('Software Engineer Intern')
    expect(lv[0].remote).toBe(false)
    expect(lv[0].postedAt).toBeTruthy()
    expect(parseLeverJobs({ ok: false }, 'a', 'A')).toEqual([])
  })

  it('parses Ashby and drops unlisted jobs', () => {
    expect(ab).toHaveLength(1)
    expect(ab[0].remote).toBe(true)
  })
})

describe('job matching', () => {
  it('detects seniority', () => {
    expect(detectSeniority('Software Engineer Intern')).toBe('intern')
    expect(detectSeniority('Senior Backend Engineer')).toBe('senior')
    expect(detectSeniority('New Grad Software Engineer')).toBe('new_grad')
    expect(detectSeniority('Software Engineer')).toBe('mid')
  })

  it('parses keyword phrases and their words', () => {
    expect(parseKeywords('backend engineer, node')).toEqual(['backend engineer', 'backend', 'engineer', 'node'])
  })

  it('ranks title matches above description matches', () => {
    const backend = scoreJob(gh[0], { keywords: 'backend engineer, node.js' })!
    const frontend = scoreJob(ab[0], { keywords: 'backend engineer, node.js' })!
    expect(backend).toBeGreaterThan(frontend)
  })

  it('applies remote, seniority and location filters', () => {
    expect(scoreJob(lv[0], { keywords: 'x', remoteOnly: true })).toBeNull()
    expect(scoreJob(gh[0], { keywords: '', seniority: ['intern'] })).toBeNull()
    expect(scoreJob(lv[0], { keywords: '', location: 'bengaluru' })).toBe(50)
    expect(scoreJob(lv[0], { keywords: '', location: 'pune' })).toBeNull()
  })

  it('rankJobs keeps only matches', () => {
    const ranked = rankJobs([...gh, ...lv, ...ab], { keywords: 'react' })
    expect(ranked.every((j) => j.score > 0)).toBe(true)
    expect(ranked.find((j) => j.title.includes('Backend'))).toBeUndefined()
    expect(ranked.map((j) => j.title)).toContain('Frontend Engineer')
  })

  it('handles keywords with symbols like c++', () => {
    expect(scoreJob({ ...gh[0], title: 'C++ Developer' }, { keywords: 'c++' })!).toBeGreaterThanOrEqual(40)
  })
})

describe('board detection', () => {
  it('finds boards linked from career pages', () => {
    expect(findBoardInHtml('<a href="https://boards.greenhouse.io/acmeinc/jobs/123">x</a>')).toEqual({ provider: 'greenhouse', boardToken: 'acmeinc' })
    expect(findBoardInHtml('<a href="https://job-boards.greenhouse.io/embed/job_board?for=acme">')).toEqual({ provider: 'greenhouse', boardToken: 'acme' })
    expect(findBoardInHtml('see https://jobs.lever.co/acme-labs/abc')).toEqual({ provider: 'lever', boardToken: 'acme-labs' })
    expect(findBoardInHtml('<iframe src="https://jobs.ashbyhq.com/Acme">')).toEqual({ provider: 'ashby', boardToken: 'Acme' })
    expect(findBoardInHtml('<p>no jobs</p>')).toBeNull()
  })

  it('guesses board tokens from a domain', () => {
    expect(guessTokens('acme-labs.io')).toEqual(['acmelabs', 'acme-labs', 'acme'])
  })
})
