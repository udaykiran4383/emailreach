import { expect, test } from '@playwright/test'
import { addRecipients, createCampaign, drainSend, localUrl, newUser, q, sentMessages } from '../helpers'

// Smallest valid-ish PDF
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

test.describe('tracked resume link', () => {
  test('enable replaces the attachment with a per-recipient link; opening it serves the PDF and logs a view', async ({ browser }) => {
    const user = await newUser(browser)
    const upload = await user.api.post('/api/upload-resume', {
      multipart: { resume: { name: 'Uday Resume.pdf', mimeType: 'application/pdf', buffer: PDF } },
    })
    expect(upload.ok(), await upload.text()).toBeTruthy()
    const { path } = await upload.json()

    const campaign = await createCampaign(user, {
      name: 'Resume link',
      resume_storage_path: path,
      email_body_template: 'Hi {{first_name}},\n\nMy resume: {{resume_url}}\n\nThanks,\nUday',
    })
    await addRecipients(user, campaign.id, [{ email: 'viewer.e2e@gmail.com', name: 'Vik Viewer', company: 'Acme' }])

    const enable = await user.api.post('/api/resume-links', { data: { campaignId: campaign.id, action: 'enable' } })
    const enabled = await enable.json()
    expect(enable.ok(), JSON.stringify(enabled)).toBeTruthy()
    expect(enabled.updated).toBe(1)
    const [{ variables, id: recipientId }] = await q('SELECT id, variables FROM email_recipients WHERE campaign_id = $1', [campaign.id])
    expect(variables.resume_url).toMatch(/\/r\/[A-Za-z0-9._-]+$/)
    expect((await q('SELECT attach_resume FROM campaigns WHERE id = $1', [campaign.id]))[0].attach_resume).toBe(false)

    await drainSend(user, campaign.id)
    const [msg] = await sentMessages(user.mailbox)
    expect(msg.hasAttachment).toBeFalsy()
    expect(msg.text).toContain(variables.resume_url)

    // Opened well after sending (views within 10s of sending are ignored as self-views)
    await q(`UPDATE email_recipients SET sent_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [recipientId])
    const res = await user.api.get(localUrl(variables.resume_url), { headers: { 'user-agent': 'Mozilla/5.0 Chrome' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/pdf')
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-')
    await expect.poll(async () => (await q('SELECT count(*)::int AS n FROM resume_views WHERE recipient_id = $1', [recipientId]))[0].n).toBe(1)

    const stats = await (await user.api.post('/api/resume-links', { data: { campaignId: campaign.id, action: 'stats' } })).json()
    expect(JSON.stringify(stats)).toContain('viewer.e2e@gmail.com')

    // Forged token -> 404, no view logged
    const forged = await user.api.get(localUrl(variables.resume_url.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'))))
    expect(forged.status()).toBe(404)
  })
})
