import { expect, test } from '@playwright/test'
import { ANTHROPIC, addRecipients, createCampaign, drainSend, inject, newUser, q, sentMessages } from '../helpers'

test.describe('AI personalization + reply triage (mock Claude)', () => {
  test('generates an opener from the company website, approval makes it {{opener}}', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, {
      name: 'Openers',
      email_body_template: 'Hi {{first_name}},\n\n{{opener}}\n\nI would love to help {{company}}.\n\nThanks,\nUday',
    })
    await addRecipients(user, campaign.id, [{ email: 'jane.doe@acmecorp.test', name: 'Jane Doe', company: 'Acme Corp' }])
    const [recipient] = await q('SELECT id FROM email_recipients WHERE campaign_id = $1', [campaign.id])

    let body: any
    for (let i = 0; i < 5; i++) {
      const res = await user.api.post(`/api/campaigns/${campaign.id}/personalize`, { data: { action: 'generate' } })
      body = await res.json()
      expect(res.ok(), JSON.stringify(body)).toBeTruthy()
      if (!body.remaining) break
    }
    expect(body.errors).toBeUndefined()
    const [{ variables }] = await q('SELECT variables FROM email_recipients WHERE id = $1', [recipient.id])
    expect(variables.opener_draft).toContain('Acme Rockets')
    expect(variables.opener_confidence).toBe('high')
    expect(variables.opener).toBe('') // drafts are not sent until approved

    // The website text reached the model wrapped as untrusted data
    const calls = (await (await fetch(`${ANTHROPIC}/__control/calls`)).json()).calls as { user: string; system: string }[]
    const call = calls.find((c) => c.user.includes('Acme Rockets'))
    expect(call?.user).toMatch(/<website>[\s\S]*Acme Rockets[\s\S]*<\/website>/)

    const approve = await user.api.post(`/api/campaigns/${campaign.id}/personalize`, {
      data: { action: 'approve', recipientId: recipient.id, approved: true },
    })
    expect(approve.ok(), await approve.text()).toBeTruthy()
    const [{ variables: approved }] = await q('SELECT variables FROM email_recipients WHERE id = $1', [recipient.id])
    expect(approved.opener).toBe(approved.opener_draft)

    // UI tab renders the draft
    await user.page.goto(`/dashboard/campaigns/${campaign.id}`)
    await user.page.getByRole('button', { name: /^Personalize$/ }).click()
    await expect(user.page.locator('textarea').filter({ hasText: 'Acme Rockets' }).first()).toBeVisible()
  })

  test('incoming replies are classified and drive follow-ups, blocklist and pipeline', async ({ browser }) => {
    const user = await newUser(browser)
    const campaign = await createCampaign(user, { name: 'Replies' })
    const people = {
      interview: { email: 'ivy.e2e@stripe.com', name: 'Ivy Chen', company: 'Stripe' },
      ooo: { email: 'omar.e2e@github.com', name: 'Omar Ali', company: 'GitHub' },
      unsub: { email: 'uma.e2e@shopify.com', name: 'Uma Rao', company: 'Shopify' },
      nothiring: { email: 'nina.e2e@atlassian.com', name: 'Nina Roy', company: 'Atlassian' },
      referral: { email: 'raj.e2e@figma.com', name: 'Raj Mehta', company: 'Figma' },
    }
    await addRecipients(user, campaign.id, Object.values(people))
    await drainSend(user, campaign.id)
    const sent = await sentMessages(user.mailbox)
    expect(sent).toHaveLength(5)
    const replyTo = (email: string, text: string, subjectOverride?: string) => {
      const first = sent.find((m) => m.to.includes(email))!
      return {
        from: email,
        subject: subjectOverride || `Re: ${first.subject}`,
        headers: { 'In-Reply-To': first.messageId, References: first.messageId },
        text,
      }
    }
    await inject(user.mailbox, [
      replyTo(people.interview.email, 'Thanks! Could we schedule a call for an interview on Thursday?'),
      replyTo(people.ooo.email, 'I am out of the office until 2026-12-01 with limited access to email.', 'Automatic reply: out of office'),
      replyTo(people.unsub.email, 'Please unsubscribe me from these emails.'),
      replyTo(people.nothiring.email, 'Thanks for reaching out, but we are not hiring right now.'),
      replyTo(people.referral.email, 'I have forwarded your email to our engineering manager as a referral.'),
    ])

    const sync = await user.api.post(`/api/campaigns/${campaign.id}/sync`)
    expect(sync.ok(), await sync.text()).toBeTruthy()

    const replies = await (await user.api.get('/api/replies')).json()
    const byFrom: Record<string, string> = {}
    for (const r of replies.replies) byFrom[String(r.from_email || r.from || r.recipient_email || '').toLowerCase()] = r.classification
    const classOf = (email: string) => Object.entries(byFrom).find(([k]) => k.includes(email))?.[1]
    expect(classOf(people.interview.email)).toBe('interview_request')
    expect(classOf(people.ooo.email)).toBe('out_of_office')
    expect(classOf(people.unsub.email)).toBe('unsubscribe')
    expect(classOf(people.nothiring.email)).toBe('not_hiring')
    expect(classOf(people.referral.email)).toBe('referral')

    const rows = Object.fromEntries(
      (await q('SELECT email, status, next_step_not_before FROM email_recipients WHERE campaign_id = $1', [campaign.id])).map((r) => [r.email, r])
    )
    // Out-of-office is not a real reply: stays 'sent' and the next step waits until after the return date
    expect(rows[people.ooo.email].status).toBe('sent')
    expect(new Date(rows[people.ooo.email].next_step_not_before).getTime()).toBeGreaterThanOrEqual(new Date('2026-12-01').getTime())
    expect(rows[people.interview.email].status).toBe('replied')
    expect((await q('SELECT reason FROM blocked_emails WHERE email = $1', [people.unsub.email]))[0]?.reason).toBe('unsubscribed')

    const stages = Object.fromEntries((await q('SELECT domain, stage FROM applications WHERE user_id = $1', [user.id])).map((r) => [r.domain, r.stage]))
    expect(stages['stripe.com']).toBe('interview')
    expect(stages['atlassian.com']).toBe('rejected')
    expect(stages['figma.com']).toBe('replied')

    await user.page.goto('/dashboard/replies')
    await expect(user.page.getByText('Interview request').first()).toBeVisible()
    await expect(user.page.getByText('Out of office').first()).toBeVisible()
  })
})
