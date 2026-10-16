import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, drainSend, newUser, q } from '../helpers'

test.describe('application pipeline', () => {
  test('sending moves companies to Contacted; stage changes via the card select are logged', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Pipeline' })
    await addRecipients(user, campaign.id, [
      { email: 'pat.e2e@stripe.com', name: 'Pat Lee', company: 'Stripe' },
      { email: 'kim.e2e@shopify.com', name: 'Kim Day', company: 'Shopify' },
    ])
    await drainSend(user, campaign.id)

    const apps = await q('SELECT id, domain, stage FROM applications WHERE user_id = $1 ORDER BY domain', [user.id])
    expect(apps.map((a) => [a.domain, a.stage])).toEqual([
      ['shopify.com', 'contacted'],
      ['stripe.com', 'contacted'],
    ])

    // Manually added target company
    const created = await user.api.post('/api/pipeline', { data: { company: 'Acme Corp', domain: 'acmecorp.test', jobTitle: 'Backend Engineer' } })
    expect(created.ok(), await created.text()).toBeTruthy()

    await user.page.goto('/dashboard/pipeline')
    const card = user.page.getByRole('button', { name: /^Stripe/ }).or(user.page.locator('[aria-label^="Stripe"]')).first()
    await expect(card).toBeVisible()
    await expect(user.page.locator('[aria-label^="Acme Corp"]').first()).toBeVisible()

    const stripe = apps.find((a) => a.domain === 'stripe.com')!
    await user.page.locator(`[aria-label^="Stripe"]`).first().locator('xpath=ancestor-or-self::*[.//select[@aria-label="Move to stage"]][1]').locator('select[aria-label="Move to stage"]').selectOption('interview')
    await expect.poll(async () => (await q('SELECT stage FROM applications WHERE id = $1', [stripe.id]))[0].stage).toBe('interview')
    const activity = await q(`SELECT kind, message FROM application_activity WHERE application_id = $1 AND kind = 'stage_change'`, [stripe.id])
    expect(activity.length).toBeGreaterThanOrEqual(1)

    // Detail API returns the contacts linked by domain
    const detail = await (await user.api.get(`/api/pipeline/${stripe.id}`)).json()
    const contacts = detail.contacts || detail.application?.contacts || []
    expect(JSON.stringify(contacts)).toContain('pat.e2e@stripe.com')

    // Forward-only: re-sending would never move it back to contacted
    const sync = await user.api.post('/api/pipeline', { data: { action: 'sync' } })
    expect(sync.ok()).toBeTruthy()
    expect((await q('SELECT stage FROM applications WHERE id = $1', [stripe.id]))[0].stage).toBe('interview')
  })
})
