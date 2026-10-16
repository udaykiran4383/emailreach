import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// MX answers per domain; anything unknown → ENOTFOUND
const MX: Record<string, { exchange: string; priority: number }[]> = {
  'gmail.com': [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }],
  'nullmx.io': [{ exchange: '.', priority: 0 }],
}
for (const d of ['acme-a.io', 'acme-b.io', 'acme-c.io', 'acme-d.io', 'acme-e.io', 'acme-f.io', 'acme-g.io', 'acme-h.io', 'role.io']) {
  MX[d] = [{ exchange: `mx.${d}`, priority: 10 }]
}

vi.mock('dns', async (importOriginal) => {
  const actual: any = await importOriginal()
  const resolveMx = (domain: string, cb: (err: any, res?: any) => void) => {
    if (domain === 'flaky.io') return cb(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))
    if (MX[domain]) return cb(null, MX[domain])
    cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }))
  }
  return { ...actual, default: { ...actual, resolveMx }, resolveMx }
})

import { quickValidateEmail, verifyEmail, verifyEmailDNS, verifyEmailsBatch } from '@/lib/email/verifier'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('quickValidateEmail', () => {
  it('catches format errors, typos and disposable domains', () => {
    expect(quickValidateEmail('not-an-email').valid).toBe(false)
    expect(quickValidateEmail('john@gmial.com')).toEqual({ valid: false, error: 'Typo detected: Did you mean john@gmail.com?' })
    expect(quickValidateEmail('x@mailinator.com').valid).toBe(false)
    expect(quickValidateEmail('priya@acme.io')).toEqual({ valid: true })
  })
})

describe('verifyEmailDNS', () => {
  it('accepts addresses on domains with MX records', async () => {
    expect((await verifyEmailDNS('Priya@Gmail.com')).status).toBe('safe')
  })

  it.each([
    ['nobody@does-not-exist.io', 'invalid'],
    ['a@nullmx.io', 'invalid'],
    ['noreply@acme-a.io', 'invalid'],
    ['postmaster@acme-a.io', 'invalid'],
    ['a..b@acme-a.io', 'invalid'],
    ['hr@role.io', 'risky'],
    ['someone@flaky.io', 'risky'],
  ])('%s → %s', async (email, status) => {
    expect((await verifyEmailDNS(email)).status).toBe(status)
  })
})

describe('verifyEmail with Reacher', () => {
  const reacher = (body: any, ok = true) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }))

  beforeEach(() => vi.stubEnv('REACHER_URL', 'http://reacher.test'))

  it('confirms deliverable mailboxes', async () => {
    reacher({ is_reachable: 'safe', smtp: { is_deliverable: true, is_catch_all: false } })
    const r = await verifyEmail('jane@acme-a.io')
    expect(r.status).toBe('safe')
    expect(r.details).toMatchObject({ confirmed: true, catchAll: false, provider: 'reacher' })
    const [url, init] = (fetch as any).mock.calls[0]
    expect(url).toBe('http://reacher.test/v0/check_email')
    expect(JSON.parse(init.body)).toEqual({ to_email: 'jane@acme-a.io' })
  })

  it('marks catch-all domains risky', async () => {
    reacher({ is_reachable: 'risky', smtp: { is_deliverable: true, is_catch_all: true } })
    const r = await verifyEmail('jane@acme-b.io')
    expect(r.status).toBe('risky')
    expect(r.details).toMatchObject({ catchAll: true, confirmed: false })
  })

  it.each([
    [{ is_reachable: 'invalid', smtp: {} }],
    [{ is_reachable: 'safe', smtp: { is_deliverable: true }, misc: { is_disposable: true } }],
    [{ is_reachable: 'risky', smtp: { is_disabled: true } }],
    [{ is_reachable: 'risky', smtp: { has_full_inbox: true } }],
  ])('marks dead mailboxes invalid: %j', async (body) => {
    reacher(body)
    expect((await verifyEmail('jane@acme-c.io')).status).toBe('invalid')
  })

  it('falls back to the MX verdict when Reacher is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await verifyEmail('jane@acme-d.io')
    expect(r.status).toBe('safe')
    expect(r.details?.confirmed).toBeUndefined()
  })

  it('never calls Reacher for addresses already invalid', async () => {
    reacher({ is_reachable: 'safe', smtp: { is_deliverable: true } })
    expect((await verifyEmail('noreply@acme-e.io')).status).toBe('invalid')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('verifyEmail with MillionVerifier', () => {
  beforeEach(() => vi.stubEnv('EMAIL_VERIFIER_API_KEY', 'k'))

  it.each([
    ['ok', 'safe', true],
    ['catch_all', 'risky', false],
    ['invalid', 'invalid', false],
  ])('result %s → %s', async (result, status, confirmed) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result }) }))
    const r = await verifyEmail(`jane-${result}@acme-f.io`)
    expect(r.status).toBe(status)
    if (status !== 'invalid') expect(r.details?.confirmed).toBe(confirmed)
  })
})

describe('verifyEmailsBatch', () => {
  it('verifies unique emails with a result per address', async () => {
    const m = await verifyEmailsBatch(['a@acme-g.io', 'a@acme-g.io', 'noreply@acme-h.io'], 2)
    expect(m.size).toBe(2)
    expect(m.get('a@acme-g.io')?.status).toBe('safe')
    expect(m.get('noreply@acme-h.io')?.status).toBe('invalid')
  })
})

describe('classifyRcptReply', () => {
  it('treats 250 as a real mailbox and 550 user-unknown as invalid', async () => {
    const { classifyRcptReply } = await import('@/lib/email/verifier')
    expect(classifyRcptReply(250, '250 2.1.5 OK').status).toBe('safe')
    expect(classifyRcptReply(550, '550-5.1.1 The email account that you tried to reach does not exist').status).toBe('invalid')
  })

  it('does not call a mailbox invalid when the server is refusing our IP', async () => {
    const { classifyRcptReply } = await import('@/lib/email/verifier')
    expect(classifyRcptReply(550, '550 5.7.1 Service unavailable, Client host [1.2.3.4] blocked using Spamhaus').status).toBe('unknown')
    expect(classifyRcptReply(550, '550 zen.mimecast.org Listed by CSS, Listed by PBL').status).toBe('unknown')
  })
})
