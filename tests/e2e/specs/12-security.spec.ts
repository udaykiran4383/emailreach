import { expect, test } from '@playwright/test'
import { CRON_SECRET, SUPABASE_URL, ANON_KEY } from '../config'
import { addRecipients, createCampaign, cron, drainSend, newUser, q, sentMessages } from '../helpers'

test.describe('cron + security', () => {
  test('cron requires the secret; with it, scheduled campaigns keep sending', async ({ browser, request }) => {
    expect((await cron(request)).status()).toBe(401)
    expect((await cron(request, 'wrong-secret')).status()).toBe(401)

    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Cron drip' })
    await addRecipients(user, campaign.id, [
      { email: 'cron1.e2e@gmail.com', name: 'Cee One', company: 'A' },
      { email: 'cron2.e2e@gmail.com', name: 'Cee Two', company: 'B' },
    ])
    // "Schedule" hands the campaign to cron
    const schedule = await user.api.post(`/api/campaigns/${campaign.id}/send`, { data: { sendImmediately: false } })
    expect(schedule.ok()).toBeTruthy()

    for (let i = 0; i < 6 && (await sentMessages(user.mailbox)).length < 2; i++) {
      const res = await cron(request, CRON_SECRET)
      expect(res.status(), await res.text()).toBe(200)
      await new Promise((r) => setTimeout(r, 1200))
    }
    expect(await sentMessages(user.mailbox)).toHaveLength(2)
    await expect.poll(async () => (await q('SELECT status FROM campaigns WHERE id = $1', [campaign.id]))[0].status).toBe('sent')
  })

  test('forged tracking tokens return a GIF but change nothing', async ({ request }) => {
    const res = await request.get('/api/track/open/Zm9yZ2Vk.AAAAAAAAAAAAAAAAAAAAAA.gif')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('image/gif')
    expect(await q(`SELECT 1 FROM email_logs WHERE event_type = 'opened' AND metadata::text LIKE '%Zm9yZ2Vk%'`)).toHaveLength(0)
  })

  test("users cannot read or modify each other's campaigns", async ({ browser }) => {
    const owner = await newUser(browser)
    const intruder = await newUser(browser)
    const campaign = await createCampaign(owner, { name: 'Private' })
    await addRecipients(owner, campaign.id, [{ email: 'secret.e2e@gmail.com', name: 'Sec Ret', company: 'X' }])

    for (const path of ['', '/recipients', '/analytics', '/steps']) {
      const res = await intruder.api.get(`/api/campaigns/${campaign.id}${path}`)
      expect(res.status(), `GET ${path}`).toBeGreaterThanOrEqual(400)
      expect(await res.text()).not.toContain('secret.e2e@gmail.com')
    }
    const patch = await intruder.api.patch(`/api/campaigns/${campaign.id}`, { data: { name: 'Hacked' } })
    expect(patch.ok()).toBeFalsy()
    const send = await intruder.api.post(`/api/campaigns/${campaign.id}/send`, { data: { sendImmediately: true } })
    expect(send.ok()).toBeFalsy()
    expect(await sentMessages(owner.mailbox)).toHaveLength(0)
    expect((await q('SELECT name FROM campaigns WHERE id = $1', [campaign.id]))[0].name).toBe('Private')

    // The owner can't reassign ownership through PATCH either
    const reassign = await owner.api.patch(`/api/campaigns/${campaign.id}`, { data: { user_id: intruder.id, name: 'Renamed' } })
    expect(reassign.ok()).toBeTruthy()
    const row = (await q('SELECT name, user_id FROM campaigns WHERE id = $1', [campaign.id]))[0]
    expect(row).toEqual({ name: 'Renamed', user_id: owner.id })

    // Row Level Security at the database API: the intruder's JWT sees nothing
    const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: intruder.email, password: intruder.password }),
    }).then((r) => r.json())
    const rest = await fetch(`${SUPABASE_URL}/rest/v1/email_recipients?select=email`, {
      headers: { apikey: ANON_KEY, authorization: `Bearer ${login.access_token}` },
    }).then((r) => r.json())
    expect(rest).toEqual([])
  })

  test('unauthenticated API calls are rejected', async ({ request }) => {
    for (const [method, path] of [
      ['GET', '/api/campaigns'],
      ['POST', '/api/extract'],
      ['POST', '/api/find-contacts'],
      ['POST', '/api/jobs/search'],
      ['GET', '/api/pipeline'],
      ['GET', '/api/replies'],
      ['POST', '/api/gmail/cleanup/trash'],
    ] as const) {
      const res = await request.fetch(path, { method, data: method === 'POST' ? {} : undefined, maxRedirects: 0 })
      expect([401, 307, 308], `${method} ${path} -> ${res.status()}`).toContain(res.status())
    }
  })
})
