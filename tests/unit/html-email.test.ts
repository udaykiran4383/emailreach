import { describe, expect, it } from 'vitest'
import { generateProfessionalHtmlEmail } from '@/lib/email/sender'

describe('generateProfessionalHtmlEmail', () => {
  it('keeps signature lines on separate lines', () => {
    const html = generateProfessionalHtmlEmail('Hi Sam,\n\nBest regards,\nUday\n+91 90000 00000')
    expect(html).toContain('Best regards,<br>\nUday<br>\n+91 90000 00000')
  })

  it('turns "- " lines into a list and blank lines into paragraphs', () => {
    const html = generateProfessionalHtmlEmail('Work:\n\n- One\n- Two\n\nThanks')
    expect(html.match(/<li /g)).toHaveLength(2)
    expect(html.match(/<p /g)).toHaveLength(2)
  })
})

describe('isHardBounce', () => {
  it('counts unknown mailboxes but not recipient-server faults', async () => {
    const { isHardBounce } = await import('@/lib/email/deliverability')
    expect(isHardBounce('Bounced: smtp; 550-5.1.1 The email account that you tried to reach does not exist')).toBe(true)
    expect(isHardBounce('Bounced: smtp;554 5.4.14 Hop count exceeded - possible mail loop')).toBe(false)
    expect(isHardBounce('552 5.2.2 The recipient mailbox is full')).toBe(false)
  })
})
