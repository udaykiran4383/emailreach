import { describe, expect, it } from 'vitest'
import { analyzeEmailContent } from '@/lib/email/spam-check'

const good = {
  subject: 'Backend internship at Acme',
  body: `Hi {{name}},

I'm a final-year CS student at IIT Bombay and I've been following Acme's work on payment APIs. I built a Postgres-backed ledger service last summer and would love to contribute to your backend team as an intern.

Would you be open to a short chat next week? My GitHub is linked below.

https://github.com/example

Best,
Uday`,
}

const messages = (r: ReturnType<typeof analyzeEmailContent>) => r.issues.map((i) => i.message).join(' | ')

describe('analyzeEmailContent', () => {
  it('scores a clean personal email as good', () => {
    const r = analyzeEmailContent(good)
    expect(r.level).toBe('good')
    expect(r.score).toBeGreaterThanOrEqual(90)
  })

  it('flags a spammy cold email as risky with the reasons', () => {
    const r = analyzeEmailContent({
      subject: 'RE: URGENT!! Act now',
      body: 'Dear {name}, CLICK HERE for a GUARANTEED offer https://bit.ly/abc https://x.io https://y.io',
      hasAttachment: true,
    })
    expect(r.level).toBe('risky')
    expect(r.score).toBeLessThan(40)
    const m = messages(r)
    expect(m).toMatch(/Spam trigger words/)
    expect(m).toMatch(/URL shortener/)
    expect(m).toMatch(/Re:/)
    expect(m).toMatch(/Unreplaced placeholder/)
    expect(m).toMatch(/Attachment on a first cold email/)
  })

  it('flags mismatched link text', () => {
    const r = analyzeEmailContent({ ...good, body: good.body + '\n<a href="https://evil.io">https://github.com/me</a>' })
    expect(messages(r)).toMatch(/Link text shows github.com but points to evil.io/)
  })

  it('mentions the tracking pixel as a low-severity issue', () => {
    const r = analyzeEmailContent({ ...good, trackOpens: true })
    expect(r.issues.find((i) => /pixel/i.test(i.message))?.severity).toBe('low')
  })

  it('wants personalization', () => {
    const r = analyzeEmailContent({ ...good, body: good.body.replace('{{name}}', 'there') })
    expect(messages(r)).toMatch(/personalization/)
  })
})
