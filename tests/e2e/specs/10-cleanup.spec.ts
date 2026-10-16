import { expect, test } from '@playwright/test'
import { SITES, addRecipients, createCampaign, inject, mailboxMessages, newUser, q } from '../helpers'

test.describe('inbox cleanup', () => {
  test('trashes promotions but never starred/important/protected mail; undo restores; unsubscribe works', async ({ browser }) => {
    const user = await newUser(browser)
    // A campaign contact who replied must be protected
    const campaign = await createCampaign(user, { name: 'Protected' })
    await addRecipients(user, campaign.id, [{ email: 'hr.lead.e2e@deals.test', name: 'Hr Lead', company: 'Deals' }])
    await q(`UPDATE email_recipients SET status = 'replied', replied_at = NOW() WHERE campaign_id = $1`, [campaign.id])

    const promos = Array.from({ length: 50 }, (_, i) => ({
      from: `Deals ${i % 5} <offers${i % 5}@shop${i % 5}.test>`,
      subject: `Sale ${i}: 50% off`,
      text: 'Huge discounts this week. Unsubscribe anytime.',
      labels: ['INBOX', 'CATEGORY_PROMOTIONS', ...(i < 3 ? ['STARRED'] : []), ...(i === 3 ? ['IMPORTANT'] : [])],
      daysAgo: 40,
    }))
    await inject(user.mailbox, [
      ...promos,
      { from: 'Hr Lead <hr.lead.e2e@deals.test>', subject: 'Re: your application', text: 'Promo-looking reply from a contact', labels: ['INBOX', 'CATEGORY_PROMOTIONS'], daysAgo: 40 },
      { from: 'Friend <friend@gmail.com>', subject: 'Dinner?', text: 'Primary mail', labels: ['INBOX'], daysAgo: 40 },
      {
        from: 'News <news@oneclick.test>',
        subject: 'Weekly news',
        text: 'news',
        labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
        headers: { 'List-Unsubscribe': '<https://lists.oneclick.test/unsubscribe?u=42>, <mailto:unsub@oneclick.test>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      },
      {
        from: 'Digest <digest@mailonly.test>',
        subject: 'Digest',
        text: 'digest',
        labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
        headers: { 'List-Unsubscribe': '<mailto:leave@mailonly.test?subject=unsubscribe%20me>' },
      },
    ])

    const scan = await (await user.api.post('/api/gmail/cleanup/scan', { data: {} })).json()
    const promotions = scan.presets.find((p: any) => p.id === 'promotions')
    // 50 promos + 2 list mails, minus 3 starred, 1 important, 1 protected contact
    expect(promotions.count ?? promotions.estimate ?? promotions.resultSizeEstimate).toBe(48)

    // Unsubscribe first (needs the messages still in the inbox)
    const unsub = await (await user.api.post('/api/gmail/cleanup/unsubscribe', { data: { senders: ['news@oneclick.test', 'digest@mailonly.test'] } })).json()
    const methods = Object.fromEntries(unsub.results.map((r: any) => [r.email, r]))
    expect(methods['news@oneclick.test']).toMatchObject({ method: 'one-click', ok: true })
    expect(methods['digest@mailonly.test']).toMatchObject({ method: 'mailto', ok: true })
    const posts = (await (await fetch(`${SITES}/__control/unsubscribes`)).json()).unsubscribes
    expect(posts).toEqual(expect.arrayContaining([expect.objectContaining({ host: 'lists.oneclick.test', body: 'List-Unsubscribe=One-Click' })]))
    const sentUnsub = (await mailboxMessages(user.mailbox, 'SENT')).find((m) => m.to.includes('leave@mailonly.test'))
    expect(sentUnsub?.subject).toBe('unsubscribe me')

    let trashed = 0
    let query = ''
    for (let i = 0; i < 10; i++) {
      const res = await (await user.api.post('/api/gmail/cleanup/trash', { data: { presetId: 'promotions' } })).json()
      trashed += res.trashed
      query = res.query
      if (!res.remaining) break
    }
    expect(trashed).toBe(48)
    const all = await mailboxMessages(user.mailbox)
    const inTrash = all.filter((m) => m.labels.includes('TRASH'))
    expect(inTrash).toHaveLength(48)
    expect(inTrash.some((m) => m.labels.includes('STARRED') || m.labels.includes('IMPORTANT'))).toBeFalsy()
    expect(inTrash.some((m) => m.from.includes('hr.lead.e2e@deals.test'))).toBeFalsy()
    expect(inTrash.some((m) => m.from.includes('friend@gmail.com'))).toBeFalsy()
    expect(all.some((m) => m.labels.includes('SENT') && m.labels.includes('TRASH'))).toBeFalsy()
    // Trash keeps the other labels so undo is exact
    expect(inTrash.every((m) => m.labels.includes('INBOX'))).toBeTruthy()

    let restored = 0
    for (let i = 0; i < 10; i++) {
      const res = await (await user.api.post('/api/gmail/cleanup/restore', { data: { query } })).json()
      restored += res.restored
      if (!res.remaining) break
    }
    expect(restored).toBe(48)
    expect((await mailboxMessages(user.mailbox)).filter((m) => m.labels.includes('TRASH'))).toHaveLength(0)

    // An empty query is refused (would match the whole mailbox)
    const refused = await user.api.post('/api/gmail/cleanup/trash', { data: { query: '' } })
    expect(refused.status()).toBeGreaterThanOrEqual(400)

    // UI loads and scans
    await user.page.goto('/dashboard/cleanup')
    await user.page.getByRole('button', { name: /scan mailbox/i }).first().click()
    await expect(user.page.getByText('Promotions').first()).toBeVisible()
  })

  test('missing gmail.modify scope asks to reconnect', async ({ browser }) => {
    const user = await newUser(browser)
    await q(`UPDATE gmail_credentials SET access_token = 'tok-noscope-' || user_id WHERE user_id = $1`, [user.id])
    const res = await user.api.post('/api/gmail/cleanup/scan', { data: {} })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('RECONNECT_REQUIRED')
  })
})
