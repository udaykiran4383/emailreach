import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, localUrl, newUser, q, sentMessages } from '../helpers'

test.describe('drip sending', () => {
  test('Send Now respects the daily limit, personalizes, adds the tracking pixel, and opens are counted', async ({ browser }) => {
    const user = await newUser(browser, { fastSending: { daily_limit: 3 } })
    const campaign = await createCampaign(user, { name: 'Drip', track_opens: true })
    await addRecipients(user, campaign.id, [
      { email: 'priya.e2e@gmail.com', name: 'Priya Sharma', company: 'Acme' },
      { email: 'rahul.e2e@gmail.com', name: 'Rahul Verma', company: 'Globex' },
      { email: 'anita.e2e@outlook.com', name: 'Anita Desai', company: 'Initech' },
      { email: 'karthik.e2e@gmail.com', name: 'Karthik Rao', company: 'Umbrella' },
      { email: 'jane.e2e@outlook.com', name: 'Jane Doe', company: 'Hooli' },
    ])

    await user.page.goto(`/dashboard/campaigns/${campaign.id}`)
    await user.page.getByRole('button', { name: /^Send Now$/ }).click()

    await expect.poll(async () => (await sentMessages(user.mailbox)).length, { timeout: 90_000 }).toBe(3)
    // The drip loop must stop at the daily limit; give it time to (wrongly) send more
    await user.page.waitForTimeout(4000)
    const sent = await sentMessages(user.mailbox)
    expect(sent).toHaveLength(3)
    await expect(user.page.getByText(/daily limit|limit reached|of 3/i).first()).toBeVisible()

    const recipients = await q('SELECT * FROM email_recipients WHERE campaign_id = $1', [campaign.id])
    const sentRows = recipients.filter((r) => r.status === 'sent')
    expect(sentRows).toHaveLength(3)
    expect(recipients.filter((r) => r.status === 'pending')).toHaveLength(2)

    for (const msg of sent) {
      const row = sentRows.find((r) => msg.to.includes(r.email))
      expect(row, `sent to unexpected ${msg.to}`).toBeTruthy()
      const firstName = row.name.split(' ')[0]
      expect(msg.subject).toBe(`Backend role at ${row.company}`)
      expect(msg.text).toContain(`Hi ${firstName},`)
      expect(msg.text).toContain(row.company)
      expect(`${msg.subject}${msg.text}${msg.html}`).not.toMatch(/\{\{|\}\}/)
      expect(msg.html).toMatch(/\/api\/track\/open\/[^"]+\.gif/)
      expect(msg.from).toContain(user.gmailAddress)
      // DB keeps the Gmail ids + RFC Message-ID for threading follow-ups
      expect(row.gmail_message_id).toBe(msg.id)
      expect(row.rfc_message_id).toBe(msg.messageId)
    }

    // Open tracking: opens within 10s of sending are ignored, so age the send first
    const first = sent[0]
    const row = sentRows.find((r) => first.to.includes(r.email))
    await q(`UPDATE email_recipients SET sent_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [row.id])
    const pixel = first.html.match(/src="([^"]+\/api\/track\/open\/[^"]+)"/)![1]
    const res = await user.api.get(localUrl(pixel.replace(/&amp;/g, '&')), { headers: { 'user-agent': 'Mozilla/5.0 (GoogleImageProxy)' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/gif')
    expect(res.headers()['cache-control']).toMatch(/no-store|no-cache/)

    const analytics = await (await user.api.get(`/api/campaigns/${campaign.id}/analytics`)).json()
    expect(analytics.totalOpened).toBe(1)
    expect(analytics.totalSent).toBe(3)
    const opened = await q('SELECT open_count, opened_at FROM email_recipients WHERE id = $1', [row.id])
    expect(opened[0].open_count).toBe(1)
    expect(opened[0].opened_at).not.toBeNull()
  })

  test('campaign without track_opens sends no pixel; outside the send window nothing is sent', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'No pixel' })
    await addRecipients(user, campaign.id, [{ email: 'nopixel.e2e@gmail.com', name: 'Nora Pixel', company: 'Acme' }])

    // Closed window: start == end - 1 at an hour that is never "now" in UTC is hard to pick, so use a 0-length-ish window
    const hour = new Date().getUTCHours()
    const closedStart = (hour + 2) % 24
    await q(`UPDATE sender_settings SET send_window_start = $2, send_window_end = $3 WHERE user_id = $1`, [user.id, closedStart, closedStart + 1])
    const closed = await (await user.api.post(`/api/campaigns/${campaign.id}/send`, { data: { sendImmediately: true } })).json()
    expect(closed.reason).toBe('outside_window')
    expect(await sentMessages(user.mailbox)).toHaveLength(0)

    await q(`UPDATE sender_settings SET send_window_start = 0, send_window_end = 24, next_send_at = NULL WHERE user_id = $1`, [user.id])
    const open = await (await user.api.post(`/api/campaigns/${campaign.id}/send`, { data: { sendImmediately: true } })).json()
    expect(open.sentCount).toBe(1)
    const [msg] = await sentMessages(user.mailbox)
    expect(msg.html).not.toContain('/api/track/open/')
  })
})
