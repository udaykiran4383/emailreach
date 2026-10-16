import { describe, expect, it, vi } from 'vitest'
import dns from 'dns'
import { assertPublicUrl, extractEmailsFromText, guessCompanyFromEmail, guessNameFromEmail } from '@/lib/email/extractor'

const emails = (text: string) => extractEmailsFromText(text).map((e) => e.email)

describe('extractEmailsFromText', () => {
  it('finds plain and mailto addresses, lowercased and deduped', () => {
    const found = emails('Write to Jane.Doe@AcmeLabs.io or <a href="mailto:jane.doe@acmelabs.io?subject=Hi">mail</a>')
    expect(found).toEqual(['jane.doe@acmelabs.io'])
  })

  it('decodes percent-encoded mailto links', () => {
    expect(emails('<a href="mailto:priya%40acmelabs.io">x</a>')).toEqual(['priya@acmelabs.io'])
  })

  it('decodes bracket obfuscations', () => {
    expect(emails('rahul [at] acmelabs [dot] io')).toEqual(['rahul@acmelabs.io'])
    expect(emails('anita(at)acmelabs(dot)io')).toEqual(['anita@acmelabs.io'])
    expect(emails('meera {at} acmelabs {dot} io')).toEqual(['meera@acmelabs.io'])
  })

  it('decodes spaced " at " / " dot " forms only when the result is valid', () => {
    expect(emails('reach karthik at acmelabs dot io today')).toEqual(['karthik@acmelabs.io'])
    expect(emails('meet me at the office')).toEqual([])
  })

  it('decodes HTML entities', () => {
    expect(emails('jobs&#64;acmelabs&#46;io')).toEqual(['jobs@acmelabs.io'])
    expect(emails('hr&#x40;acmelabs.io')).toEqual(['hr@acmelabs.io'])
  })

  it('decodes Cloudflare email protection', () => {
    const key = 0x2a
    const hex = key.toString(16).padStart(2, '0') + Buffer.from(Buffer.from('ceo@acmelabs.io').map((b) => b ^ key)).toString('hex')
    expect(emails(`<a class="__cf_email__" data-cfemail="${hex}">[email protected]</a>`)).toEqual(['ceo@acmelabs.io'])
  })

  it('filters junk: assets, retina images, placeholders, sentry hashes', () => {
    const text = [
      'logo@2x.png',
      'icon@acme.png',
      'user@example.com',
      'someone@domain.com',
      '8f14e45fceea167a5a36dedd4bea2543@sentry.io',
      '0123456789abcdef0123456789abcdef@o123.ingest.sentry.io',
      'real.person@acmelabs.io',
    ].join(' ')
    expect(emails(text)).toEqual(['real.person@acmelabs.io'])
  })

  it('attaches name, company and source', () => {
    const [e] = extractEmailsFromText('jane.doe@acme-labs.co.in', 'https://acme/team')
    expect(e).toMatchObject({ email: 'jane.doe@acme-labs.co.in', name: 'Jane Doe', company: 'Acme Labs', source: 'https://acme/team' })
  })
})

describe('name and company guessing', () => {
  it('guesses names from local parts', () => {
    expect(guessNameFromEmail('priya_sharma92@acme.io')).toBe('Priya Sharma')
    expect(guessNameFromEmail('careers@acme.io')).toBe('')
    expect(guessNameFromEmail('j@acme.io')).toBe('')
  })

  it('guesses companies, skipping free mail providers', () => {
    expect(guessCompanyFromEmail('a@acme-labs.co.in')).toBe('Acme Labs')
    expect(guessCompanyFromEmail('a@stripe.com')).toBe('Stripe')
    expect(guessCompanyFromEmail('a@gmail.com')).toBe('')
    expect(guessCompanyFromEmail('a@yahoo.co.in')).toBe('')
  })
})

describe('assertPublicUrl (SSRF guard)', () => {
  const lookup = (address: string) =>
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }] as any)

  it.each(['http://localhost/x', 'http://intranet.local/', 'http://metadata.internal/'])('rejects private hostnames: %s', async (u) => {
    await expect(assertPublicUrl(new URL(u))).rejects.toThrow(/Private/)
  })

  it.each(['http://127.0.0.1/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://192.168.1.10/', 'http://[::1]/'])(
    'rejects private IP literals: %s',
    async (u) => {
      await expect(assertPublicUrl(new URL(u))).rejects.toThrow(/Private/)
    }
  )

  it('rejects hostnames that resolve to private addresses', async () => {
    lookup('10.1.2.3')
    await expect(assertPublicUrl(new URL('https://evil.example.org/'))).rejects.toThrow(/Private/)
  })

  it('rejects non-http protocols', async () => {
    await expect(assertPublicUrl(new URL('file:///etc/passwd'))).rejects.toThrow(/http/)
  })

  it('allows public hosts', async () => {
    lookup('93.184.216.34')
    await expect(assertPublicUrl(new URL('https://acmelabs.io/team'))).resolves.toBeUndefined()
  })
})
