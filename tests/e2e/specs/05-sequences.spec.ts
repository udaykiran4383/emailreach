import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, drainSend, inject, newUser, q, sentMessages } from '../helpers'

async function sendDueSteps(user: Awaited<ReturnType<typeof newUser>>, campaignId: string) {
  const results: any[] = []
  for (let i = 0; i < 10; i++) {
    const res = await user.api.post(`/api/campaigns/${campaignId}/send-followup?due=1`)
    const body = await res.json()
    results.push(body)
    expect(res.ok(), JSON.stringify(body)).toBeTruthy()
    if (!body.remaining || ['done', 'daily_limit', 'outside_window'].includes(body.reason)) break
    await new Promise((r) => setTimeout(r, 1200))
  }
  return results
}

test.describe('multi-step sequences', () => {
  test('due steps thread under the first email; a colleague reply stops the rest of the company', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Sequence' })
    // Company domain (not gmail/outlook) so "colleague replied" applies; real MX so verification passes
    const alex = 'alex.e2e@stripe.com'
    const sam = 'sam.e2e@stripe.com'
    const lee = 'lee.e2e@gmail.com'
    await addRecipients(user, campaign.id, [
      { email: alex, name: 'Alex Stone', company: 'Stripe' },
      { email: sam, name: 'Sam Lake', company: 'Stripe' },
      { email: lee, name: 'Lee Park', company: 'Solo' },
    ])
    await drainSend(user, campaign.id)
    const firsts = await sentMessages(user.mailbox)
    expect(firsts).toHaveLength(3)

    const put = await user.api.put(`/api/campaigns/${campaign.id}/steps`, {
      data: {
        steps: [
          { delay_days: 2, body: 'Hi {{first_name}}, just bumping this up in case it got buried.' },
          { delay_days: 4, body: 'Hi {{first_name}}, last note from me — thanks for reading!' },
        ],
      },
    })
    expect(put.ok(), await put.text()).toBeTruthy()

    // Not due yet: nothing goes out
    await sendDueSteps(user, campaign.id)
    expect(await sentMessages(user.mailbox)).toHaveLength(3)

    // Time travel: first emails went out 3 days ago
    await q(`UPDATE email_recipients SET sent_at = NOW() - INTERVAL '3 days' WHERE campaign_id = $1`, [campaign.id])
    await sendDueSteps(user, campaign.id)
    const afterStep2 = await sentMessages(user.mailbox)
    expect(afterStep2).toHaveLength(6)
    for (const first of firsts) {
      const followUp = afterStep2.find((m) => m.to === first.to && m.id !== first.id)!
      expect(followUp, `no step 2 for ${first.to}`).toBeTruthy()
      expect(followUp.threadId).toBe(first.threadId)
      expect(followUp.inReplyTo).toBe(first.messageId)
      expect(followUp.references).toContain(first.messageId)
      expect(followUp.subject).toBe(`Re: ${first.subject}`)
      expect(followUp.text).toMatch(/^Hi \w+, just bumping/)
    }
    const step2 = await q('SELECT email, current_step, follow_up_sent FROM email_recipients WHERE campaign_id = $1', [campaign.id])
    expect(step2.every((r) => r.current_step === 2 && r.follow_up_sent === true)).toBeTruthy()

    // Alex replies; Sam (same company) must not get step 3, Lee still does
    const alexFirst = firsts.find((m) => m.to.includes(alex))!
    await inject(user.mailbox, [
      {
        from: `Alex Stone <${alex}>`,
        subject: `Re: ${alexFirst.subject}`,
        headers: { 'In-Reply-To': alexFirst.messageId, References: alexFirst.messageId },
        text: 'Thanks for reaching out, happy to chat next week.',
      },
    ])
    expect((await user.api.post(`/api/campaigns/${campaign.id}/sync`)).ok()).toBeTruthy()

    await q(`UPDATE email_recipients SET last_step_sent_at = NOW() - INTERVAL '5 days' WHERE campaign_id = $1`, [campaign.id])
    await sendDueSteps(user, campaign.id)
    const all = await sentMessages(user.mailbox)
    const step3 = all.filter((m) => /last note/.test(m.text))
    expect(step3.map((m) => m.to)).toEqual([expect.stringContaining(lee)])
    const rows = Object.fromEntries((await q('SELECT email, status, current_step FROM email_recipients WHERE campaign_id = $1', [campaign.id])).map((r) => [r.email, r]))
    expect(rows[alex].status).toBe('replied')
    expect(rows[sam].current_step).toBe(2)
    expect(rows[lee].current_step).toBe(3)
  })

  test('placement test sends a prefixed copy to seed inboxes and records manual results', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Placement' })
    await addRecipients(user, campaign.id, [{ email: 'seed.target.e2e@gmail.com', name: 'Mira Seed', company: 'Acme' }])
    const res = await user.api.post('/api/placement-test', {
      data: { campaignId: campaign.id, seedEmails: ['my.other.e2e@gmail.com', 'my.work.e2e@outlook.com'] },
    })
    const body = await res.json()
    expect(res.ok(), JSON.stringify(body)).toBeTruthy()
    const sent = await sentMessages(user.mailbox)
    expect(sent.map((m) => m.to).sort()).toEqual([expect.stringContaining('my.other.e2e@gmail.com'), expect.stringContaining('my.work.e2e@outlook.com')])
    expect(sent.every((m) => m.subject.startsWith('[Placement test] '))).toBeTruthy()
    expect(sent.every((m) => !/\{\{/.test(m.text))).toBeTruthy()
    // Campaign recipients were not emailed
    expect((await q(`SELECT status FROM email_recipients WHERE campaign_id = $1`, [campaign.id]))[0].status).toBe('pending')
    expect(await q('SELECT id FROM placement_tests WHERE user_id = $1', [user.id])).toHaveLength(1)
  })
})
