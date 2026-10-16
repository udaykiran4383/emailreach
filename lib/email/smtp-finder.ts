/**
 * Finds real mailboxes by asking a domain's mail server about candidate addresses
 * (SMTP RCPT TO, no message is ever sent). Several candidates share one connection,
 * the way a normal mail server delivers to many recipients at once.
 *
 * Needs outbound port 25. Servers that refuse checks from the caller's IP (Microsoft
 * 365 and Mimecast refuse residential IPs) or accept every address (catch-all) give
 * no answer, so those domains are reported as unverifiable rather than guessed.
 */
import dns from 'dns/promises'
import net from 'net'
import os from 'os'
import { classifyRcptReply, type SmtpProbeResult } from './verifier'
import { PATTERNS, applyPattern } from './email-patterns'

export type DomainKind = 'probeable' | 'catch_all' | 'blocked' | 'no_mx' | 'unreachable'

export interface DomainCheck {
  kind: DomainKind
  mx?: string
  reason?: string
}

const SESSION_TIMEOUT_MS = 15_000

export interface SessionResult {
  results: Map<string, SmtpProbeResult>
  /** The server said "try again later" (rate limit / greylisting): stop and come back later */
  throttled: boolean
}

/** Opens one SMTP session and asks about each address in turn. Missing entries = no answer. */
export function probeSession(mx: string, emails: string[]): Promise<SessionResult> {
  return new Promise((resolve) => {
    const results = new Map<string, SmtpProbeResult>()
    let throttled = false
    const helo = process.env.SMTP_VERIFY_HELO || os.hostname()
    const mailFrom = process.env.SMTP_VERIFY_FROM || `verify@${helo}`
    const socket = new net.Socket()
    let buffer = ''
    let lines: string[] = []
    let step = 0 // 0 banner, 1 EHLO, 2 MAIL FROM, 3+ RCPT n-3
    let done = false

    const finish = () => {
      if (done) return
      done = true
      try { socket.write('QUIT\r\n') } catch { }
      socket.destroy()
      resolve({ results, throttled })
    }

    const onReply = (code: number, text: string) => {
      if (code >= 400 && code < 500) {
        // Temporary refusal: no verdict for anyone in this session
        throttled = true
        return finish()
      }
      if (step >= 3) {
        const result = classifyRcptReply(code, text)
        results.set(emails[step - 3], result)
        // A refusal about our IP applies to the whole session
        if (result.status === 'unknown') return finish()
      } else if (code >= 500) {
        return finish()
      }
      step++
      if (step === 1) socket.write(`EHLO ${helo}\r\n`)
      else if (step === 2) socket.write(`MAIL FROM:<${mailFrom}>\r\n`)
      else if (step - 3 < emails.length) socket.write(`RCPT TO:<${emails[step - 3]}>\r\n`)
      else finish()
    }

    socket.setTimeout(SESSION_TIMEOUT_MS)
    socket.on('data', (data) => {
      buffer += data.toString()
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        lines.push(line)
        if (/^\d{3}( |$)/.test(line)) {
          const text = lines.join('\n')
          lines = []
          onReply(parseInt(line.slice(0, 3), 10), text)
          if (done) return
        }
      }
    })
    socket.on('error', finish)
    socket.on('timeout', finish)
    socket.on('close', finish)
    socket.connect(25, mx)
  })
}

const randomLocal = () => `zq${Math.random().toString(36).slice(2, 10)}x`

/** Finds the MX and learns whether this domain answers honestly about mailboxes. */
export async function checkDomain(domain: string): Promise<DomainCheck> {
  let mx: string
  try {
    const records = (await dns.resolveMx(domain)).filter((r) => r.exchange).sort((a, b) => a.priority - b.priority)
    if (!records.length) return { kind: 'no_mx' }
    mx = records[0].exchange
  } catch {
    return { kind: 'no_mx' }
  }

  const fake = `${randomLocal()}@${domain}`
  const { results, throttled } = await probeSession(mx, [fake])
  const r = results.get(fake)
  if (!r) return { kind: 'unreachable', mx, reason: throttled ? 'Rate-limited, try later' : 'No SMTP answer' }
  if (r.status === 'safe') return { kind: 'catch_all', mx }
  if (r.status === 'invalid') return { kind: 'probeable', mx }
  return { kind: 'blocked', mx, reason: r.reason }
}

/** Candidate addresses for a person, most likely first (a known company pattern goes first). */
export function candidateEmails(first: string, last: string, domain: string, preferred?: string | null): string[] {
  const order = preferred ? [preferred, ...PATTERNS.filter((p) => p !== preferred)] : [...PATTERNS]
  const out: string[] = []
  for (const pattern of order) {
    const local = applyPattern(pattern, first, last)
    if (local && local.length >= 2) out.push(`${local}@${domain}`)
  }
  return [...new Set(out)]
}

export const ROLE_INBOXES = ['careers', 'hr', 'jobs', 'hiring', 'talent', 'recruitment', 'people'] as const
