import fs from 'fs'
import path from 'path'
import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, drainSend, newUser, q } from '../helpers'

// Migrations the harness applies from scripts/: each should report OK on a fresh database
const MIGRATION_IDS = fs
  .readdirSync(path.join(__dirname, '../../../scripts'))
  .map((f) => f.match(/^(0[89]|1\d)_.*\.sql$/)?.[1])
  .filter((n): n is string => Boolean(n))
  .map((n) => `migration-${n}`)

async function health(api: import('@playwright/test').APIRequestContext) {
  const res = await api.get('/api/health')
  expect(res.ok(), await res.text()).toBeTruthy()
  return res.json() as Promise<{ checks: { id: string; status: string; detail: string }[]; summary: Record<string, number> }>
}

test.describe('setup checklist + dashboard home', () => {
  test('health reports migrations, Gmail and a stalled scheduler; the setup page shows it', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Stalled campaign' })
    await addRecipients(user, campaign.id, [{ email: 'pat.e2e@stripe.com', name: 'Pat Lee', company: 'Stripe' }])
    await q(`UPDATE campaigns SET status = 'scheduled' WHERE id = $1`, [campaign.id])

    // Scheduler never ran → warning, and the waiting campaign is an error
    await q(`DELETE FROM app_heartbeats WHERE key = 'cron'`)
    let report = await health(user.api)
    const byId = (id: string) => report.checks.find((c) => c.id === id)

    expect(MIGRATION_IDS.length).toBeGreaterThanOrEqual(7)
    for (const id of MIGRATION_IDS) expect(byId(id)?.status, `${id}: ${byId(id)?.detail}`).toBe('ok')
    expect(byId('gmail-connected')?.status).toBe('ok')
    expect(byId('cron-heartbeat')?.status).toBe('warn')
    expect(byId('cron-stalled-campaigns')?.status).toBe('error')
    expect(byId('env-cron-secret')?.status).toBe('ok')
    expect(byId('env-site-url')?.status).toBe('ok')
    expect(byId('bounce-rate')?.status).toBe('ok')
    expect(report.summary.total).toBe(report.checks.length)

    // UI: checklist groups, the stalled campaign, and the red dot in the sidebar
    await user.page.goto('/dashboard/setup')
    await expect(user.page.getByRole('heading', { name: 'Setup checklist' })).toBeVisible()
    await expect(user.page.getByTestId('group-database')).toBeVisible()
    await expect(user.page.getByTestId('check-cron-stalled-campaigns')).toHaveAttribute('data-status', 'error')
    await expect(user.page.getByTestId('check-cron-stalled-campaigns').getByRole('button', { name: /npm run scheduler:lite/ })).toBeVisible()
    await expect(user.page.getByText(/^\(\d+ setup issues?\)$/)).toBeAttached()

    // Dashboard shows the setup banner while something needs fixing
    await user.page.goto('/dashboard')
    await expect(user.page.getByTestId('setup-banner')).toContainText('Scheduled campaigns are stalled')

    // A fresh heartbeat clears both
    await q(`INSERT INTO app_heartbeats (key, at) VALUES ('cron', NOW()) ON CONFLICT (key) DO UPDATE SET at = NOW()`)
    report = await health(user.api)
    expect(byId('cron-heartbeat')?.status).toBe('ok')
    expect(byId('cron-stalled-campaigns')).toBeUndefined()

    await user.page.goto('/dashboard/setup')
    await user.page.getByRole('button', { name: 'Re-check' }).click()
    await expect(user.page.getByTestId('check-cron-heartbeat')).toHaveAttribute('data-status', 'ok')
    await expect(user.page.getByTestId('check-cron-stalled-campaigns')).toHaveCount(0)
  })

  test('dashboard home shows today’s budget, the 7-day chart and active campaign progress', async ({ browser }) => {
    const user = await newUser(browser, { fastSending: { daily_limit: 1 } })
    const campaign = await createCampaign(user, { name: 'Home progress' })
    await addRecipients(user, campaign.id, [
      { email: 'pat.e2e@stripe.com', name: 'Pat Lee', company: 'Stripe' },
      { email: 'kim.e2e@shopify.com', name: 'Kim Day', company: 'Shopify' },
    ])
    const results = await drainSend(user, campaign.id)
    expect(results.at(-1)?.reason).toBe('daily_limit')

    const summary = await (await user.api.get('/api/dashboard/summary')).json()
    expect(summary.today).toMatchObject({ sent: 1, limit: 1, remaining: 0 })
    expect(summary.chart).toHaveLength(7)
    expect(summary.chart.at(-1).sent).toBe(1)
    const active = summary.activeCampaigns.find((c: any) => c.id === campaign.id)
    expect(active).toMatchObject({ total: 2, sent: 1, pending: 1 })
    expect(summary.totals.sent30).toBe(1)

    await user.page.goto('/dashboard')
    const today = user.page.getByTestId('today-card')
    await expect(today).toContainText('/ 1 sent')
    await expect(today).toContainText(/Daily limit reached/)
    await expect(user.page.getByRole('heading', { name: 'Last 7 days' })).toBeVisible()
    await expect(user.page.getByText('No email activity in the last 7 days')).toHaveCount(0)
    // Bars must actually paint (an SVG fill of var(...) silently renders nothing)
    const sentBar = user.page.locator('.viz-series-1 .recharts-rectangle').first()
    await expect(sentBar).toBeVisible()
    expect(await sentBar.evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(42, 120, 214)')
    const activeCard = user.page.getByTestId('active-campaigns')
    await expect(activeCard).toContainText('Home progress')
    await expect(activeCard).toContainText('1 of 2 sent')

    // Table view of the chart for screen readers / exact numbers
    await user.page.getByRole('button', { name: 'Table' }).click()
    await expect(user.page.getByRole('columnheader', { name: 'Replied' })).toBeVisible()

    // Another user's dashboard never sees this campaign
    const other = await newUser(browser)
    const otherSummary = await (await other.api.get('/api/dashboard/summary')).json()
    expect(otherSummary.activeCampaigns.find((c: any) => c.id === campaign.id)).toBeUndefined()
    expect(otherSummary.totals.sent30).toBe(0)
  })
})
