import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, drainSend, inject, newUser, q, sentMessages } from '../helpers'

test.describe('bounces and unsubscribes', () => {
  test('sync marks hard bounces, blocks bounced + unsubscribed addresses, and later uploads skip them', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Bounces' })
    const bad = 'ghost.e2e@gmail.com'
    const optOut = 'optout.e2e@gmail.com'
    const fine = 'fine.e2e@gmail.com'
    await addRecipients(user, campaign.id, [
      { email: bad, name: 'Ghost User', company: 'Nowhere' },
      { email: optOut, name: 'Opt Out', company: 'Elsewhere' },
      { email: fine, name: 'Fine Person', company: 'Okay' },
    ])
    await drainSend(user, campaign.id)
    const sent = await sentMessages(user.mailbox)
    expect(sent).toHaveLength(3)
    const toOptOut = sent.find((m) => m.to.includes(optOut))!

    await inject(user.mailbox, [
      {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        subject: 'Delivery Status Notification (Failure)',
        headers: { 'X-Failed-Recipients': bad },
        text: `Address not found\n\nYour message wasn't delivered to ${bad} because the address couldn't be found.\n\n550 5.1.1 The email account that you tried to reach does not exist.`,
        deliveryStatus: `Reporting-MTA: dns; googlemail.com\n\nFinal-Recipient: rfc822; ${bad}\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.`,
      },
      {
        from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
        subject: 'Delivery Status Notification (Delay)',
        headers: { 'X-Failed-Recipients': fine },
        text: `Message temporarily deferred for ${fine}. 451 4.2.0 Try again later.`,
        deliveryStatus: `Final-Recipient: rfc822; ${fine}\nAction: delayed\nStatus: 4.2.0`,
      },
      {
        from: `Opt Out <${optOut}>`,
        subject: `Re: ${toOptOut.subject}`,
        headers: { 'In-Reply-To': toOptOut.messageId, References: toOptOut.messageId },
        text: 'Please remove me from your list and stop emailing me.',
      },
    ])

    const res = await user.api.post(`/api/campaigns/${campaign.id}/sync`)
    expect(res.ok(), await res.text()).toBeTruthy()

    const rows = Object.fromEntries((await q('SELECT email, status, error_message FROM email_recipients WHERE campaign_id = $1', [campaign.id])).map((r) => [r.email, r]))
    expect(rows[bad].status).toBe('bounced')
    expect(rows[fine].status).toBe('sent') // 4.x.x delays are not bounces
    const blocked = Object.fromEntries((await q('SELECT email, reason FROM blocked_emails WHERE email = ANY($1)', [[bad, optOut, fine]])).map((r) => [r.email, r.reason]))
    expect(blocked[bad]).toBe('bounced')
    expect(blocked[optOut]).toBe('unsubscribed')
    expect(blocked[fine]).toBeUndefined()

    // Re-running sync is idempotent
    expect((await user.api.post(`/api/campaigns/${campaign.id}/sync`)).ok()).toBeTruthy()
    expect(await q('SELECT 1 FROM blocked_emails WHERE email = $1', [bad])).toHaveLength(1)

    // A new campaign refuses the blocked addresses at upload time
    const next = await createCampaign(user, { name: 'Second' })
    const upload = await addRecipients(user, next.id, [{ email: bad }, { email: optOut }, { email: 'new.e2e@gmail.com' }])
    expect(upload.blocked).toBe(2)
    expect(upload.count).toBe(1)
  })
})
