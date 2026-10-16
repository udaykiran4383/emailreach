import { describe, expect, it } from 'vitest'
import { buildUnsubscribeRawMessage, parseListUnsubscribe, parseMailto, planUnsubscribe } from '@/lib/gmail/unsubscribe'
import { extractMessageText, isUnsubscribeIntent } from '@/lib/email/bounces'

const b64 = (s: string) => Buffer.from(s).toString('base64url')

describe('List-Unsubscribe parsing', () => {
  it('splits https and mailto entries', () => {
    expect(parseListUnsubscribe('<mailto:unsub@news.shop.com?subject=stop>, <https://shop.com/u/123>, <http://plain.shop.com/u>')).toEqual({
      https: ['https://shop.com/u/123'],
      mailto: ['mailto:unsub@news.shop.com?subject=stop'],
    })
    expect(parseListUnsubscribe(undefined)).toEqual({ https: [], mailto: [] })
  })

  it('parses mailto targets with defaults', () => {
    expect(parseMailto('mailto:unsub@shop.com?subject=Remove%20me')).toEqual({ to: 'unsub@shop.com', subject: 'Remove me', body: 'unsubscribe' })
    expect(parseMailto('mailto:unsub@shop.com')).toMatchObject({ subject: 'unsubscribe' })
    expect(parseMailto('mailto:not-an-address')).toBeNull()
  })

  it('prefers RFC 8058 one-click, then mailto, then a manual link', () => {
    const header = '<mailto:u@shop.com>, <https://shop.com/u/1>'
    expect(planUnsubscribe(header, 'List-Unsubscribe=One-Click')).toMatchObject({ method: 'one-click', url: 'https://shop.com/u/1' })
    expect(planUnsubscribe(header, null)).toMatchObject({ method: 'mailto' })
    expect(planUnsubscribe('<https://shop.com/u/1>', null)).toMatchObject({ method: 'manual', url: 'https://shop.com/u/1' })
    expect(planUnsubscribe('<http://shop.com/u/1>', 'List-Unsubscribe=One-Click').method).toBe('none')
    expect(planUnsubscribe(null, null).method).toBe('none')
  })

  it('builds an unsubscribe email without header injection', () => {
    const encoded = buildUnsubscribeRawMessage('me@gmail.com', { to: 'u@shop.com', subject: 'stop\r\nBcc: victim@x.com', body: 'unsubscribe' })
    const raw = Buffer.from(encoded, 'base64url').toString()
    expect(raw).toContain('To: u@shop.com')
    expect(raw).toContain('Subject: stop Bcc: victim@x.com')
    expect(raw).not.toMatch(/^Bcc:/m)
  })
})

describe('bounce + reply helpers', () => {
  it('detects unsubscribe intent in replies', () => {
    for (const t of ['Please unsubscribe me', 'remove me from this list', 'Stop emailing me', 'take me off your list']) {
      expect(isUnsubscribeIntent(t)).toBe(true)
    }
    expect(isUnsubscribeIntent('Thanks, happy to chat')).toBe(false)
    expect(isUnsubscribeIntent('')).toBe(false)
  })

  it('extracts text from nested MIME parts including delivery-status reports', () => {
    const text = extractMessageText({
      mimeType: 'multipart/report',
      parts: [
        { mimeType: 'text/plain', body: { data: b64("Address not found: jdoe@acme.io") } },
        { mimeType: 'message/delivery-status', body: { data: b64('Final-Recipient: rfc822; jdoe@acme.io\nStatus: 5.1.1') } },
        { mimeType: 'image/png', body: { data: b64('BINARY') } },
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>nested</p>') } }] },
      ],
    })
    expect(text).toContain('Address not found')
    expect(text).toContain('Status: 5.1.1')
    expect(text).toContain('<p>nested</p>')
    expect(text).not.toContain('BINARY')
    expect(extractMessageText(undefined)).toBe('')
  })
})
