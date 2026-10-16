import { describe, expect, it, vi } from 'vitest'

// placement.ts pulls in the Gmail sender and storage; only the pure helpers are tested here
vi.mock('@/lib/email/sender', () => ({ sendEmailViaGmail: vi.fn() }))
vi.mock('@/lib/storage/resume', () => ({ downloadResume: vi.fn() }))

import { normalizeSeeds, summarizePlacement } from '@/lib/email/placement'

describe('placement test helpers', () => {
  it('validates seed inboxes', () => {
    expect(normalizeSeeds(['me@gmail.com'], 'Me@Gmail.com').error).toBe('Me@Gmail.com is the account you send from - use a different inbox')
    expect(normalizeSeeds([], 'x@y.com').error).toBe('Add at least one inbox to test')
    expect(normalizeSeeds(['a@b.co', 'bad'], 'x@y.com').error).toBe('Not an email address: bad')
    expect(normalizeSeeds([' A@b.co ', 'a@b.co'], 'x@y.com')).toEqual({ seeds: ['a@b.co'] })
  })

  it('summarizes recorded placements with advice', () => {
    const s = summarizePlacement([
      { email: 'a', sent: true, placement: 'spam' },
      { email: 'b', sent: true, placement: 'inbox' },
      { email: 'c', sent: true, placement: null },
    ])
    expect(s.counts).toEqual({ inbox: 1, promotions: 0, spam: 1, missing: 0 })
    expect(s.recorded).toBe(2)
    expect(s.advice[0]).toMatch(/^Landed in Spam/)
    expect(summarizePlacement([{ email: 'a', sent: true, placement: 'inbox' }]).advice[0]).toMatch(/^Everything reached/)
  })
})
