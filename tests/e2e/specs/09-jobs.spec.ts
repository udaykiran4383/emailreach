import { expect, test } from '@playwright/test'
import { newUser, q } from '../helpers'

test.describe('hiring-now jobs (mock Greenhouse)', () => {
  test('detects the board from the careers page, scores jobs, and Track saves + adds to the pipeline', async ({ browser }) => {
    const user = await newUser(browser, { gmail: false, fastSending: false })
    const res = await user.api.post('/api/jobs/search', { data: { companies: ['acmecorp.test'], keywords: 'backend engineer, node' } })
    const body = await res.json()
    expect(res.ok(), JSON.stringify(body)).toBeTruthy()
    const result = body.results[0]
    expect(result.provider).toBe('greenhouse')
    expect(result.boardToken).toBe('acmecorp')
    expect(result.jobs.length).toBeGreaterThanOrEqual(2)
    // Best match first; sales role scores lowest
    expect(result.jobs[0].title).toBe('Backend Engineer (Node.js)')
    const sales = result.jobs.find((j: any) => j.title === 'Account Executive')
    if (sales) expect(sales.score).toBeLessThan(result.jobs[0].score)

    const track = await user.api.post('/api/jobs/track', { data: { job: { ...result.jobs[0], domain: 'acmecorp.test' }, domain: 'acmecorp.test' } })
    expect(track.ok(), await track.text()).toBeTruthy()
    const saved = await q('SELECT title, provider FROM saved_jobs WHERE user_id = $1', [user.id])
    expect(saved).toEqual([{ title: 'Backend Engineer (Node.js)', provider: 'greenhouse' }])
    const apps = await q('SELECT domain, stage, job_title FROM applications WHERE user_id = $1', [user.id])
    expect(apps).toEqual([expect.objectContaining({ domain: 'acmecorp.test', stage: 'target' })])

    // A company without a public board reports a clear error instead of failing the request
    const none = await (await user.api.post('/api/jobs/search', { data: { companies: ['nojobs.test'], keywords: 'backend' } })).json()
    expect(none.results[0].jobs).toHaveLength(0)
    expect(none.results[0].error).toBeTruthy()

    // UI renders the job
    await user.page.goto('/dashboard/jobs')
    await user.page.getByPlaceholder(/razorpay\.com/).fill('acmecorp.test')
    await user.page.getByPlaceholder(/backend engineer, node/).fill('backend node')
    await user.page.getByRole('button', { name: /find open roles/i }).first().click()
    await expect(user.page.getByText('Backend Engineer (Node.js)').first()).toBeVisible({ timeout: 60_000 })
  })
})
