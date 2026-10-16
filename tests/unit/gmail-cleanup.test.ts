import { describe, expect, it } from 'vitest'
import { buildBaseQuery, buildSafeQuery, parseFromHeader } from '@/lib/gmail/cleanup'

describe('buildSafeQuery', () => {
  const q = buildSafeQuery('category:promotions', ['HR@Acme.com', 'hr@acme.com', 'bad entry', 'x"y@z.com', 'me@gmail.com'])

  it('keeps the base query first', () => {
    expect(q.startsWith('category:promotions ')).toBe(true)
  })

  it('always protects starred, important, sent, drafts, chats and the keep label', () => {
    for (const term of ['-is:starred', '-is:important', '-in:sent', '-in:drafts', '-in:chats', '-label:emailreach-keep']) {
      expect(q).toContain(term)
    }
  })

  it('excludes protected senders, normalized and deduped, dropping invalid entries', () => {
    expect(q.endsWith('-from:(hr@acme.com OR me@gmail.com)')).toBe(true)
  })

  it('omits the from clause when nobody is protected', () => {
    expect(buildSafeQuery('x')).not.toContain('-from:')
  })

  it('caps protected senders at 150', () => {
    const many = Array.from({ length: 300 }, (_, i) => `u${i}@d.com`)
    expect(buildSafeQuery('x', many).match(/@/g)).toHaveLength(150)
  })
})

describe('buildBaseQuery', () => {
  it('builds preset + age queries', () => {
    expect(buildBaseQuery({ presetId: 'promotions', age: '1y' })).toBe('category:promotions older_than:1y')
  })

  it('adds valid senders only', () => {
    expect(buildBaseQuery({ presetId: 'social', senders: ['A@b.com', 'bad one'] })).toBe('category:social from:(a@b.com)')
  })

  it.each([{}, { query: '   ' }, { query: '-is:starred' }, { age: '1y' }])('refuses queries that would match everything: %j', (input) => {
    expect(() => buildBaseQuery(input as any)).toThrow(/empty query/)
  })

  it('rejects unknown presets and ages', () => {
    expect(() => buildBaseQuery({ presetId: 'nope' })).toThrow(/Unknown preset/)
    expect(() => buildBaseQuery({ presetId: 'social', age: '5y' as any })).toThrow(/Invalid age/)
  })
})

describe('parseFromHeader', () => {
  it('splits display name and lowercases the address', () => {
    expect(parseFromHeader('"Shop Deals" <News@Shop.com>')).toEqual({ name: 'Shop Deals', email: 'news@shop.com' })
    expect(parseFromHeader('plain@x.com')).toEqual({ name: '', email: 'plain@x.com' })
  })
})
