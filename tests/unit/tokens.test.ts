import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenTrackingUrl, createTrackingToken, getPublicBaseUrl, verifyTrackingToken } from '@/lib/email/tracking'
import { createResumeToken, createResumeUrl, isAutomatedViewer, verifyResumeToken } from '@/lib/resume-links'
import { extractBearerToken, generateApiToken, hashApiToken } from '@/lib/api-token'
import { isApiTokenRoute } from '@/lib/api-token-routes'

const RID = '7d9f3c1e-1111-4222-8333-944455556666'

afterEach(() => vi.unstubAllEnvs())

describe('open-tracking tokens', () => {
  it('round-trips and accepts the .gif suffix', () => {
    const t = createTrackingToken(RID)
    expect(verifyTrackingToken(t)).toBe(RID)
    expect(verifyTrackingToken(`${t}.gif`)).toBe(RID)
  })

  it('rejects forged or malformed tokens', () => {
    const t = createTrackingToken(RID)
    const [, sig] = t.split('.')
    const forged = `${Buffer.from('another-recipient').toString('base64url')}.${sig}`
    expect(verifyTrackingToken(forged)).toBeNull()
    expect(verifyTrackingToken('garbage')).toBeNull()
    expect(verifyTrackingToken('')).toBeNull()
  })

  it('does not create pixels for localhost-only setups', () => {
    vi.stubEnv('TRACKING_BASE_URL', '')
    vi.stubEnv('URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')
    expect(getPublicBaseUrl()).toBeNull()
    expect(createOpenTrackingUrl(RID)).toBeNull()
  })

  it('builds pixel URLs from the public site URL', () => {
    vi.stubEnv('TRACKING_BASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://reach.example.app/')
    expect(createOpenTrackingUrl(RID)).toMatch(/^https:\/\/reach\.example\.app\/api\/track\/open\/[\w-]+\.[\w-]+\.gif$/)
  })
})

describe('resume link tokens', () => {
  it('round-trips with and without a recipient', () => {
    expect(verifyResumeToken(createResumeToken('link1', RID))).toEqual({ linkId: 'link1', recipientId: RID })
    expect(verifyResumeToken(createResumeToken('link1'))).toEqual({ linkId: 'link1', recipientId: null })
  })

  it('cannot be swapped with an open-tracking token or forged', () => {
    expect(verifyResumeToken(createTrackingToken(RID))).toBeNull()
    const [, sig] = createResumeToken('link1', RID).split('.')
    expect(verifyResumeToken(`${Buffer.from(`link1.someone-else`).toString('base64url')}.${sig}`)).toBeNull()
  })

  it('needs a public URL', () => {
    vi.stubEnv('TRACKING_BASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://127.0.0.1:3000')
    expect(createResumeUrl('link1', RID)).toBeNull()
  })

  it('flags link scanners and bots', () => {
    expect(isAutomatedViewer('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isAutomatedViewer('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false)
  })
})

describe('API tokens', () => {
  it('generates prefixed tokens and stores only a hash', () => {
    const { token, hash, prefix } = generateApiToken()
    expect(token).toMatch(/^erk_[A-Za-z0-9_-]{40,}$/)
    expect(hash).toBe(hashApiToken(token))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(token.startsWith(prefix)).toBe(true)
  })

  it('parses Bearer headers strictly', () => {
    const { token } = generateApiToken()
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token)
    expect(extractBearerToken(token)).toBeNull()
    expect(extractBearerToken('Bearer wrongprefix_abcdefghijklmnopqrstuvwxyz')).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
  })

  it('only allows read-ish routes, never sending or Gmail cleanup', () => {
    expect(isApiTokenRoute('GET', '/api/campaigns')).toBe(true)
    expect(isApiTokenRoute('post', '/api/find-contacts/')).toBe(true)
    expect(isApiTokenRoute('POST', '/api/campaigns/abc/send')).toBe(false)
    expect(isApiTokenRoute('POST', '/api/gmail/cleanup/trash')).toBe(false)
    expect(isApiTokenRoute('POST', '/api/api-tokens')).toBe(false)
    expect(isApiTokenRoute('DELETE', '/api/campaigns')).toBe(false)
  })
})
