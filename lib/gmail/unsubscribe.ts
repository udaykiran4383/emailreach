/**
 * Parsing for the List-Unsubscribe / List-Unsubscribe-Post headers (RFC 2369, RFC 8058).
 * Pure functions, no I/O, so they're easy to test.
 */

export type UnsubscribeMethod = 'one-click' | 'mailto' | 'manual' | 'none'

export interface MailtoTarget {
  to: string
  subject: string
  body: string
}

export interface UnsubscribePlan {
  method: UnsubscribeMethod
  /** https URL to POST for one-click, or to open manually */
  url?: string
  mailto?: MailtoTarget
}

/** Pulls the <...> entries out of a List-Unsubscribe header value. */
export function parseListUnsubscribe(header: string | null | undefined): { https: string[]; mailto: string[] } {
  const https: string[] = []
  const mailto: string[] = []
  for (const match of (header || '').matchAll(/<\s*([^>]+?)\s*>/g)) {
    const value = match[1].trim()
    if (/^https:\/\//i.test(value)) https.push(value)
    else if (/^mailto:/i.test(value)) mailto.push(value)
  }
  return { https, mailto }
}

export function parseMailto(uri: string): MailtoTarget | null {
  const raw = uri.replace(/^mailto:/i, '')
  const [addressPart, queryPart = ''] = raw.split('?')
  let to: string
  try {
    to = decodeURIComponent(addressPart).trim()
  } catch {
    return null
  }
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(to)) return null

  const params = new URLSearchParams(queryPart)
  return {
    to,
    subject: (params.get('subject') || 'unsubscribe').slice(0, 200),
    body: (params.get('body') || 'unsubscribe').slice(0, 1000),
  }
}

/**
 * Decides how to unsubscribe. Preference: RFC 8058 one-click POST, then a
 * mailto request, then an https link the user opens themselves. We never
 * auto-GET arbitrary links: some are tracking or confirmation pages.
 */
export function planUnsubscribe(listUnsubscribe: string | null | undefined, listUnsubscribePost: string | null | undefined): UnsubscribePlan {
  const { https, mailto } = parseListUnsubscribe(listUnsubscribe)
  const oneClick = /List-Unsubscribe\s*=\s*One-Click/i.test(listUnsubscribePost || '')

  if (oneClick && https.length > 0) return { method: 'one-click', url: https[0] }

  for (const uri of mailto) {
    const target = parseMailto(uri)
    if (target) return { method: 'mailto', mailto: target }
  }

  if (https.length > 0) return { method: 'manual', url: https[0] }
  return { method: 'none' }
}

/** Builds a base64url-encoded RFC 822 message for the Gmail API. */
export function buildUnsubscribeRawMessage(from: string, target: MailtoTarget): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, ' ')
  const message = [
    `From: ${clean(from)}`,
    `To: ${clean(target.to)}`,
    `Subject: ${clean(target.subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    target.body,
  ].join('\r\n')
  return Buffer.from(message).toString('base64url')
}
