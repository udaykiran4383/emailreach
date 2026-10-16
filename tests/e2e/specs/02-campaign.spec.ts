import { expect, test } from '@playwright/test'
import { createCampaign, newUser, q } from '../helpers'

test.describe('campaign setup', () => {
  test('CSV upload dedupes, verification skips disposable + typo domains', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'CSV upload' })

    await user.page.goto(`/dashboard/campaigns/${campaign.id}`)
    await user.page.getByRole('button', { name: /^Recipients$/ }).click()

    const csv = [
      'email,name,company',
      'alice.e2e@gmail.com,Alice Kumar,Acme',
      'bob.e2e@outlook.com,Bob Singh,Globex',
      'temp.e2e@mailinator.com,Temp Person,Spammy',
      'carol.e2e@gmial.com,Carol Typo,Typo Inc',
      'Alice.E2E@gmail.com,Alice Again,Acme',
    ].join('\n')
    await user.page.locator('input[type="file"]').setInputFiles({ name: 'recipients.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

    // Upload toast reports the count and the skipped duplicate
    // BUG: no <Toaster /> is mounted anywhere, so sonner toasts never render (soft so the flow continues)
    await expect.soft(user.page.getByText('Uploaded 4 recipients')).toBeVisible({ timeout: 5000 })
    await expect.poll(async () => (await q('SELECT count(*)::int AS n FROM email_recipients WHERE campaign_id = $1', [campaign.id]))[0].n).toBe(4)
    expect((await q('SELECT count(*)::int AS n FROM email_recipients WHERE campaign_id = $1', [campaign.id]))[0].n).toBe(4)

    await user.page.getByRole('button', { name: /verify emails/i }).click()
    await expect
      .poll(async () => (await q(`SELECT count(*)::int AS n FROM email_recipients WHERE campaign_id = $1 AND verified_at IS NOT NULL`, [campaign.id]))[0].n, {
        timeout: 60_000,
      })
      .toBe(4)

    const rows = await q<{ email: string; status: string; verification_status: string }>(
      'SELECT email, status, verification_status FROM email_recipients WHERE campaign_id = $1 ORDER BY email',
      [campaign.id]
    )
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]))
    expect(byEmail['alice.e2e@gmail.com']).toMatchObject({ status: 'pending', verification_status: 'safe' })
    expect(byEmail['bob.e2e@outlook.com']).toMatchObject({ status: 'pending', verification_status: 'safe' })
    expect(byEmail['temp.e2e@mailinator.com']).toMatchObject({ status: 'skipped', verification_status: 'invalid' })
    expect(byEmail['carol.e2e@gmial.com']).toMatchObject({ status: 'skipped', verification_status: 'invalid' })
  })

  test('deliverability panel flags a spammy template', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, {
      name: 'Spammy',
      subject_template: 'Re: URGENT!!! FREE MONEY',
      email_body_template: 'Click here http://bit.ly/x for a GUARANTEED risk-free offer!!! Act now {name}.',
    })
    await user.page.goto(`/dashboard/campaigns/${campaign.id}`)
    const panel = user.page.getByText('Deliverability check').locator('xpath=ancestor::div[contains(@class,"border")][1]')
    await expect(user.page.getByText('Deliverability check')).toBeVisible()
    const scoreText = await user.page.getByText(/^\d+\/100$/).first().textContent()
    expect(Number(scoreText!.split('/')[0])).toBeLessThan(50)
    await expect(panel.getByText(/shortener|bit\.ly/i).first()).toBeVisible()
    await expect(panel.getByText(/re:|fwd/i).first()).toBeVisible()
  })
})
