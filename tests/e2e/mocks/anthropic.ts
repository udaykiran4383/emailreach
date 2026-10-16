import http from 'http'
import { PORTS } from '../config'

/**
 * Deterministic stand-in for the Anthropic Messages API (POST /v1/messages).
 * Returns a single text block containing JSON, which is what structured-output parsing reads.
 * - Prompts with <website> data  -> opener JSON
 * - Prompts with <email> data    -> reply classification JSON, chosen from keywords in the email
 */

export const calls: { model: string; system: string; user: string }[] = []

function classify(email: string) {
  const t = email.toLowerCase()
  if (/out of (the )?office|on leave|on vacation|back on/.test(t)) {
    const date = email.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? null
    return { category: 'out_of_office', reason: 'Auto-reply: away', return_date: date }
  }
  if (/unsubscribe|remove me|stop emailing/.test(t)) return { category: 'unsubscribe', reason: 'Asked to stop', return_date: null }
  if (/interview|schedule a call|book a time/.test(t)) return { category: 'interview_request', reason: 'Wants to schedule an interview', return_date: null }
  if (/refer|referral|forwarded your/.test(t)) return { category: 'referral', reason: 'Forwarded to a colleague', return_date: null }
  if (/send (me )?(your )?(resume|cv)/.test(t)) return { category: 'send_resume', reason: 'Asked for resume', return_date: null }
  if (/not hiring|no open(ings| roles)|hiring freeze/.test(t)) return { category: 'not_hiring', reason: 'No openings', return_date: null }
  if (/unfortunately|decided not|other candidates/.test(t)) return { category: 'rejection', reason: 'Declined', return_date: null }
  if (/interested|sounds great|let'?s talk/.test(t)) return { category: 'interested', reason: 'Positive reply', return_date: null }
  return { category: 'other', reason: 'Unclear', return_date: null }
}

function respond(body: any) {
  const system = Array.isArray(body.system) ? body.system.map((b: any) => b.text).join('\n') : String(body.system || '')
  const user = (body.messages || [])
    .map((m: any) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c: any) => c.text || '').join('\n')))
    .join('\n')
  calls.push({ model: body.model, system, user })

  let payload: unknown
  if (/<email>/.test(user)) {
    payload = classify(user.split('<email>')[1] || user)
  } else {
    const site = user.split('<website>')[1] || ''
    const product = site.match(/Acme Rockets/)?.[0]
    payload = product
      ? { opener: `I noticed ${product} and how it helps small teams ship faster.`, basis: `Homepage mentions ${product}`, confidence: 'high' }
      : { opener: 'I have been following your team’s work for a while.', basis: 'No specific detail found', confidence: 'low' }
  }
  return {
    id: `msg_e2e_${calls.length}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  }
}

let server: http.Server | null = null

export async function startAnthropicMock() {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x')
      if (url.pathname === '/__control/calls') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ calls }))
      }
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
        res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_e2e_${calls.length}` })
        return res.end(JSON.stringify(respond(body)))
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }))
    })
  })
  await new Promise<void>((resolve) => server!.listen(PORTS.anthropic, '127.0.0.1', resolve))
}

export async function stopAnthropicMock() {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
}
