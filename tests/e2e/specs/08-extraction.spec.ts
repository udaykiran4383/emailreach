import { expect, test } from '@playwright/test'
import { newUser } from '../helpers'

test.describe('email extraction + decision-maker finder (fixture site acmecorp.test)', () => {
  test('extract page crawls the fixture site and decodes obfuscated addresses', async ({ browser }) => {
    const user = await newUser(browser, { gmail: false, fastSending: false })

    const res = await user.api.post('/api/extract', { data: { urls: ['https://acmecorp.test/'], crawl: true, verify: true } })
    const body = await res.json()
    expect(res.ok(), JSON.stringify(body)).toBeTruthy()
    const emails = body.emails.map((e: any) => e.email).sort()
    expect(emails).toEqual(
      expect.arrayContaining([
        'careers@acmecorp.test',
        'hr@acmecorp.test', // &#64; / &#46; entities
        'jane.doe@acmecorp.test', // mailto with ?subject
        'karthik.rao@acmecorp.test',
        'press@acmecorp.test',
        'sales@acmecorp.test', // "sales [at] acmecorp [dot] test"
        'support@acmecorp.test', // mailto:support%40...
      ])
    )
    expect(emails).not.toContain('someone@example.com')
    expect(emails.some((e: string) => e.includes('@2x'))).toBeFalsy()
    expect(body.pagesFetched).toBeGreaterThanOrEqual(3)
    const jane = body.emails.find((e: any) => e.email === 'jane.doe@acmecorp.test')
    expect(jane.name).toBe('Jane Doe')
    // Fixture domain has no MX record, so verification must not call it safe
    expect(jane.verification?.status).not.toBe('safe')

    // UI: paste text, extract, results table shows the address
    await user.page.goto('/dashboard/extract')
    await user.page.getByPlaceholder(/Paste a team page/).fill('Reach our recruiter at talent.lead [at] gmail [dot] com or ceo@acmecorp.test')
    await user.page.getByRole('button', { name: /extract/i }).first().click()
    await expect(user.page.getByText('talent.lead@gmail.com').first()).toBeVisible({ timeout: 60_000 })
    await expect(user.page.getByText('ceo@acmecorp.test').first()).toBeVisible()
  })

  test('find-contacts identifies CEO / CTO / HR / tech lead with titles and infers the email pattern', async ({ browser }) => {
    const user = await newUser(browser, { gmail: false, fastSending: false })
    const res = await user.api.post('/api/find-contacts', {
      // Fixture domain has no MX, so verified guesses would be (correctly) dropped as invalid
      data: { companies: ['acmecorp.test'], roles: [], verify: false, guessPatterns: true },
    })
    const body = await res.json()
    expect(res.ok(), JSON.stringify(body)).toBeTruthy()
    const company = body.companies[0]
    expect(company.domain).toBe('acmecorp.test')
    expect(company.pattern).toBe('{first}.{last}')
    expect(company.patternSource).toBe('observed')
    expect(company.peopleFound).toBeGreaterThanOrEqual(4)

    const byName = Object.fromEntries(body.contacts.filter((c: any) => c.name).map((c: any) => [c.name, c]))
    expect(byName['Priya Sharma']).toMatchObject({ role: 'ceo', title: 'Chief Executive Officer' })
    expect(byName['Rahul Verma']).toMatchObject({ role: 'cto', email: 'rahul.verma@acmecorp.test', source: 'pattern' })
    expect(byName['Anita Desai']).toMatchObject({ role: 'hr' })
    expect(byName['Karthik Rao']).toMatchObject({ role: 'tech_lead', email: 'karthik.rao@acmecorp.test', source: 'website' })
    // With verification on, unconfirmable pattern guesses never come back as "safe"
    const verified = await (await user.api.post('/api/find-contacts', { data: { companies: ['acmecorp.test'], roles: [], verify: true } })).json()
    expect(verified.contacts.filter((c: any) => c.source === 'pattern' && c.verification?.status === 'safe')).toHaveLength(0)
    // Roles filter
    const hrOnly = await (await user.api.post('/api/find-contacts', { data: { companies: ['acmecorp.test'], roles: ['hr'] } })).json()
    expect(hrOnly.contacts.length).toBeGreaterThan(0)
    expect(hrOnly.contacts.every((c: any) => c.role === 'hr')).toBeTruthy()

    // Social networks are refused
    const social = await (await user.api.post('/api/find-contacts', { data: { companies: ['linkedin.com/company/acme'], roles: [] } })).json()
    expect(social.companies[0].errors.join(' ')).toMatch(/social/i)
  })
})
