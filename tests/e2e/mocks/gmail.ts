import crypto from 'crypto'
import http from 'http'
import { simpleParser } from 'mailparser'
import { PORTS } from '../config'

/**
 * In-memory Gmail API + Google OAuth token endpoint.
 * One mailbox per access token (seeded per test user as `tok-<userId>`), so specs stay isolated.
 * Control API (used by specs):
 *   POST /__control/reset?mailbox=TOKEN {email}
 *   POST /__control/inject?mailbox=TOKEN {messages: InjectMessage[]}
 *   GET  /__control/messages?mailbox=TOKEN[&label=SENT]
 *   GET  /__control/unknown-terms
 */

export interface InjectMessage {
  from: string
  to?: string
  subject?: string
  text?: string
  html?: string
  headers?: Record<string, string>
  labels?: string[] // e.g. ['INBOX','CATEGORY_PROMOTIONS','STARRED','UNREAD']
  daysAgo?: number
  threadId?: string
  sizeEstimate?: number
  deliveryStatus?: string // body of a message/delivery-status part (bounces)
}

interface StoredMessage {
  id: string
  threadId: string
  labelIds: Set<string>
  headers: { name: string; value: string }[]
  text: string
  html: string
  internalDate: number
  sizeEstimate: number
  deliveryStatus?: string
  raw?: string
}

interface Mailbox {
  email: string
  messages: StoredMessage[]
}

const mailboxes = new Map<string, Mailbox>()
const unknownTerms = new Set<string>()

function mailbox(token: string): Mailbox {
  let box = mailboxes.get(token)
  if (!box) {
    box = { email: 'me@e2e.test', messages: [] }
    mailboxes.set(token, box)
  }
  return box
}

const newId = () => crypto.randomBytes(8).toString('hex')

function header(m: StoredMessage, name: string): string {
  return m.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function addressOf(value: string): string {
  const angle = value.match(/<([^>]+)>/)
  return (angle ? angle[1] : value).trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Gmail search query matcher (pragmatic subset of Gmail's syntax)
// ---------------------------------------------------------------------------
type Node =
  | { type: 'and'; items: Node[] }
  | { type: 'or'; items: Node[] }
  | { type: 'not'; item: Node }
  | { type: 'term'; field: string | null; value: string }

function tokenize(q: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < q.length) {
    const c = q[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '(' || c === ')') {
      tokens.push(c)
      i++
      continue
    }
    if (c === '"') {
      const end = q.indexOf('"', i + 1)
      const stop = end === -1 ? q.length : end
      tokens.push(q.slice(i, stop + 1))
      i = stop + 1
      continue
    }
    let j = i
    while (j < q.length && !/[\s()]/.test(q[j])) {
      if (q[j] === '"') {
        const end = q.indexOf('"', j + 1)
        j = end === -1 ? q.length : end + 1
        continue
      }
      j++
    }
    tokens.push(q.slice(i, j))
    i = j
  }
  return tokens
}

function parseQuery(q: string): Node {
  const tokens = tokenize(q)
  let pos = 0
  function parseOr(): Node {
    const items = [parseAnd()]
    while (tokens[pos] === 'OR') {
      pos++
      items.push(parseAnd())
    }
    return items.length === 1 ? items[0] : { type: 'or', items }
  }
  function parseAnd(): Node {
    const items: Node[] = []
    while (pos < tokens.length && tokens[pos] !== ')' && tokens[pos] !== 'OR') items.push(parseUnary())
    return { type: 'and', items }
  }
  function parseUnary(): Node {
    let tok = tokens[pos++]
    let negate = false
    if (tok.startsWith('-') && tok.length > 1) {
      negate = true
      tok = tok.slice(1)
    } else if (tok === '-') {
      negate = true
      tok = tokens[pos++]
    }
    let node: Node
    if (tok === '(') {
      node = parseOr()
      pos++ // ')'
    } else {
      const m = tok.match(/^([a-z_]+):(.*)$/i)
      if (m && m[2] === '' && tokens[pos] === '(') {
        // field:(a OR b)
        pos++
        const inner = parseOr()
        pos++
        node = applyField(inner, m[1].toLowerCase())
      } else if (m) {
        node = { type: 'term', field: m[1].toLowerCase(), value: m[2].replace(/^"|"$/g, '') }
      } else {
        node = { type: 'term', field: null, value: tok.replace(/^"|"$/g, '') }
      }
    }
    return negate ? { type: 'not', item: node } : node
  }
  function applyField(node: Node, field: string): Node {
    if (node.type === 'term') return node.field ? node : { ...node, field }
    if (node.type === 'not') return { type: 'not', item: applyField(node.item, field) }
    return { ...node, items: node.items.map((n) => applyField(n, field)) }
  }
  return parseOr()
}

const DAY = 24 * 3600 * 1000
function durationMs(v: string): number {
  const m = v.match(/^(\d+)([dmy])$/i)
  if (!m) return 0
  const n = Number(m[1])
  return m[2].toLowerCase() === 'd' ? n * DAY : m[2].toLowerCase() === 'm' ? n * 30 * DAY : n * 365 * DAY
}
function sizeBytes(v: string): number {
  const m = v.match(/^(\d+)([km]?)$/i)
  if (!m) return 0
  return Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1024 * 1024 : m[2].toLowerCase() === 'k' ? 1024 : 1)
}

function matchTerm(m: StoredMessage, field: string | null, value: string): boolean {
  const v = value.toLowerCase()
  const has = (label: string) => m.labelIds.has(label)
  switch (field) {
    case null: {
      const hay = `${header(m, 'subject')} ${m.text} ${m.html} ${header(m, 'from')}`.toLowerCase()
      return hay.includes(v)
    }
    case 'from':
      return header(m, 'from').toLowerCase().includes(v)
    case 'to':
      return header(m, 'to').toLowerCase().includes(v)
    case 'subject':
      return header(m, 'subject').toLowerCase().includes(v)
    case 'newer_than':
      return m.internalDate >= Date.now() - durationMs(v)
    case 'older_than':
      return m.internalDate < Date.now() - durationMs(v)
    case 'larger':
      return m.sizeEstimate > sizeBytes(v)
    case 'smaller':
      return m.sizeEstimate < sizeBytes(v)
    case 'category':
      if (v === 'primary') {
        return !['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].some(has)
      }
      return has(`CATEGORY_${v.toUpperCase()}`)
    case 'in':
      if (v === 'anywhere') return true
      return has(v.toUpperCase())
    case 'is':
      return has(v.toUpperCase())
    case 'label':
      return has(v.toUpperCase()) || has(v)
    case 'has':
      if (v === 'attachment') return false
      unknownTerms.add(`has:${v}`)
      return true
    default:
      unknownTerms.add(`${field}:${v}`)
      return true
  }
}

function evaluate(node: Node, m: StoredMessage): boolean {
  switch (node.type) {
    case 'and':
      return node.items.every((n) => evaluate(n, m))
    case 'or':
      return node.items.some((n) => evaluate(n, m))
    case 'not':
      return !evaluate(node.item, m)
    case 'term':
      return matchTerm(m, node.field, node.value)
  }
}

function mentionsTrashOrSpam(q: string) {
  return /\bin:(trash|spam|anywhere)\b/i.test(q)
}

export function searchMessages(box: Mailbox, q: string, includeSpamTrash = false): StoredMessage[] {
  const tree = q.trim() ? parseQuery(q) : ({ type: 'and', items: [] } as Node)
  const allowTrash = includeSpamTrash || mentionsTrashOrSpam(q)
  return box.messages
    .filter((m) => allowTrash || (!m.labelIds.has('TRASH') && !m.labelIds.has('SPAM')))
    .filter((m) => evaluate(tree, m))
    .sort((a, b) => b.internalDate - a.internalDate)
}

// ---------------------------------------------------------------------------
// Message resource rendering
// ---------------------------------------------------------------------------
const b64 = (s: string) => Buffer.from(s).toString('base64url')

function payload(m: StoredMessage, format: string, metadataHeaders: string[]) {
  const headers =
    format === 'metadata' && metadataHeaders.length
      ? m.headers.filter((h) => metadataHeaders.some((n) => n.toLowerCase() === h.name.toLowerCase()))
      : m.headers
  if (format === 'metadata' || format === 'minimal') return { mimeType: 'multipart/alternative', headers }
  const parts: any[] = []
  if (m.text) parts.push({ partId: '0', mimeType: 'text/plain', headers: [], body: { size: m.text.length, data: b64(m.text) } })
  if (m.html) parts.push({ partId: String(parts.length), mimeType: 'text/html', headers: [], body: { size: m.html.length, data: b64(m.html) } })
  if (m.deliveryStatus) {
    parts.push({
      partId: String(parts.length),
      mimeType: 'message/delivery-status',
      headers: [],
      body: { size: m.deliveryStatus.length, data: b64(m.deliveryStatus) },
    })
  }
  return {
    mimeType: m.deliveryStatus ? 'multipart/report' : 'multipart/alternative',
    headers,
    body: { size: 0 },
    parts,
  }
}

function render(m: StoredMessage, format = 'full', metadataHeaders: string[] = []) {
  const base: any = {
    id: m.id,
    threadId: m.threadId,
    labelIds: [...m.labelIds],
    snippet: (m.text || m.html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200),
    internalDate: String(m.internalDate),
    sizeEstimate: m.sizeEstimate,
    historyId: '1',
  }
  if (format === 'raw') base.raw = Buffer.from(m.raw || '').toString('base64url')
  else if (format !== 'minimal') base.payload = payload(m, format, metadataHeaders)
  return base
}

function injectInto(box: Mailbox, input: InjectMessage): StoredMessage {
  const id = newId()
  const headers: { name: string; value: string }[] = [
    { name: 'From', value: input.from },
    { name: 'To', value: input.to || box.email },
    { name: 'Subject', value: input.subject || '' },
    { name: 'Date', value: new Date(Date.now() - (input.daysAgo || 0) * DAY).toUTCString() },
    { name: 'Message-ID', value: `<${id}@mock.e2e.test>` },
  ]
  for (const [name, value] of Object.entries(input.headers || {})) {
    const existing = headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
    if (existing) existing.value = value
    else headers.push({ name, value })
  }
  // Replies join the thread of the message they answer (by In-Reply-To), like Gmail does
  let threadId = input.threadId
  const inReplyTo = headers.find((h) => h.name.toLowerCase() === 'in-reply-to')?.value
  if (!threadId && inReplyTo) {
    threadId = box.messages.find((m) => header(m, 'message-id') === inReplyTo)?.threadId
  }
  const msg: StoredMessage = {
    id,
    threadId: threadId || id,
    labelIds: new Set(input.labels || ['INBOX', 'UNREAD']),
    headers,
    text: input.text || '',
    html: input.html || '',
    internalDate: Date.now() - (input.daysAgo || 0) * DAY,
    sizeEstimate: input.sizeEstimate || (input.text || '').length + (input.html || '').length + 500,
    deliveryStatus: input.deliveryStatus,
  }
  box.messages.push(msg)
  return msg
}

async function storeSent(box: Mailbox, raw: string, threadId?: string): Promise<StoredMessage> {
  const parsed = await simpleParser(raw)
  const headers: { name: string; value: string }[] = []
  for (const line of parsed.headerLines) {
    const idx = line.line.indexOf(':')
    headers.push({ name: line.line.slice(0, idx).trim(), value: line.line.slice(idx + 1).replace(/\r?\n\s+/g, ' ').trim() })
  }
  const id = newId()
  // Gmail assigns its own Message-ID when the client supplies none; nodemailer always supplies one.
  if (!headers.some((h) => h.name.toLowerCase() === 'message-id')) {
    headers.push({ name: 'Message-ID', value: `<${id}@mail.gmail.com>` })
  }
  const known = threadId && box.messages.some((m) => m.threadId === threadId)
  const msg: StoredMessage = {
    id,
    threadId: known ? threadId! : id,
    labelIds: new Set(['SENT']),
    headers,
    text: parsed.text || '',
    html: typeof parsed.html === 'string' ? parsed.html : '',
    internalDate: Date.now(),
    sizeEstimate: raw.length,
    raw,
  }
  box.messages.push(msg)
  return msg
}

/** Shape returned by GET /__control/messages (used by specs). */
export function summarize(m: StoredMessage) {
  return {
    id: m.id,
    threadId: m.threadId,
    labels: [...m.labelIds],
    from: header(m, 'from'),
    to: header(m, 'to'),
    subject: header(m, 'subject'),
    messageId: header(m, 'message-id'),
    inReplyTo: header(m, 'in-reply-to'),
    references: header(m, 'references'),
    listUnsubscribe: header(m, 'list-unsubscribe'),
    text: m.text,
    html: m.html,
    internalDate: m.internalDate,
    hasAttachment: /Content-Disposition:\s*attachment/i.test(m.raw || ''),
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString()
      if (!s) return resolve({})
      try {
        resolve(JSON.parse(s))
      } catch {
        resolve(Object.fromEntries(new URLSearchParams(s)))
      }
    })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function gmailError(res: http.ServerResponse, status: number, message: string) {
  send(res, status, { error: { code: status, message, errors: [{ message, reason: 'notFound' }] } })
}

let server: http.Server | null = null

export async function startGmailMock() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORTS.gmail}`)
    const p = url.pathname
    try {
      // ---- control API ----
      if (p.startsWith('/__control/')) {
        const token = url.searchParams.get('mailbox') || ''
        if (p === '/__control/reset') {
          const body = await readJson(req)
          mailboxes.set(token, { email: body.email || 'me@e2e.test', messages: [] })
          return send(res, 200, { ok: true })
        }
        if (p === '/__control/inject') {
          const body = await readJson(req)
          const box = mailbox(token)
          const created = (body.messages || []).map((m: InjectMessage) => summarize(injectInto(box, m)))
          return send(res, 200, { messages: created })
        }
        if (p === '/__control/messages') {
          const label = url.searchParams.get('label')
          const msgs = mailbox(token).messages.filter((m) => !label || m.labelIds.has(label))
          return send(res, 200, { messages: msgs.map(summarize) })
        }
        if (p === '/__control/unknown-terms') return send(res, 200, { terms: [...unknownTerms] })
        return send(res, 404, { error: 'unknown control route' })
      }

      // ---- Google OAuth token endpoint (refresh) ----
      if (p === '/token' && req.method === 'POST') {
        const body = await readJson(req)
        const refresh = String(body.refresh_token || '')
        return send(res, 200, {
          access_token: refresh.replace(/^refresh-/, 'tok-') || 'tok-refreshed',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify',
        })
      }
      if (p === '/tokeninfo') {
        return send(res, 200, { scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify', expires_in: 3600 })
      }

      // ---- Gmail API ----
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (!token) return gmailError(res, 401, 'Request is missing required authentication credential.')
      if (token.startsWith('tok-noscope')) {
        return send(res, 403, {
          error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }], status: 'PERMISSION_DENIED' },
        })
      }
      const box = mailbox(token)
      const m = p.match(/^\/gmail\/v1\/users\/[^/]+\/(.*)$/)
      if (!m) return gmailError(res, 404, `mock gmail: ${p}`)
      const route = m[1]

      if (route === 'profile') {
        return send(res, 200, { emailAddress: box.email, messagesTotal: box.messages.length, threadsTotal: new Set(box.messages.map((x) => x.threadId)).size, historyId: '1' })
      }

      if (route === 'messages/send' && req.method === 'POST') {
        const body = await readJson(req)
        const raw = Buffer.from(String(body.raw || ''), 'base64url').toString()
        const msg = await storeSent(box, raw, body.threadId)
        return send(res, 200, { id: msg.id, threadId: msg.threadId, labelIds: [...msg.labelIds] })
      }

      if (route === 'messages' && req.method === 'GET') {
        const q = url.searchParams.get('q') || ''
        const labelIds = url.searchParams.getAll('labelIds')
        const includeSpamTrash = url.searchParams.get('includeSpamTrash') === 'true'
        let found = searchMessages(box, q, includeSpamTrash)
        if (labelIds.length) found = found.filter((x) => labelIds.every((l) => x.labelIds.has(l)))
        const max = Math.min(Number(url.searchParams.get('maxResults') || 100), 500)
        const offset = Number(url.searchParams.get('pageToken') || 0)
        const page = found.slice(offset, offset + max)
        const next = offset + max < found.length ? String(offset + max) : undefined
        return send(res, 200, {
          messages: page.length ? page.map((x) => ({ id: x.id, threadId: x.threadId })) : undefined,
          nextPageToken: next,
          resultSizeEstimate: found.length,
        })
      }

      if (route === 'messages/batchModify' && req.method === 'POST') {
        const body = await readJson(req)
        for (const id of body.ids || []) {
          const msg = box.messages.find((x) => x.id === id)
          if (!msg) continue
          for (const l of body.addLabelIds || []) msg.labelIds.add(l)
          for (const l of body.removeLabelIds || []) msg.labelIds.delete(l)
        }
        res.writeHead(204)
        return res.end()
      }

      const single = route.match(/^messages\/([^/]+)(?:\/(trash|untrash|modify))?$/)
      if (single) {
        const msg = box.messages.find((x) => x.id === single[1])
        if (!msg) return gmailError(res, 404, 'Requested entity was not found.')
        if (single[2] === 'trash') msg.labelIds.add('TRASH')
        if (single[2] === 'untrash') msg.labelIds.delete('TRASH')
        if (single[2] === 'modify') {
          const body = await readJson(req)
          for (const l of body.addLabelIds || []) msg.labelIds.add(l)
          for (const l of body.removeLabelIds || []) msg.labelIds.delete(l)
        }
        return send(res, 200, render(msg, url.searchParams.get('format') || 'full', url.searchParams.getAll('metadataHeaders')))
      }

      const thread = route.match(/^threads\/([^/]+)$/)
      if (thread) {
        const msgs = box.messages.filter((x) => x.threadId === thread[1]).sort((a, b) => a.internalDate - b.internalDate)
        if (!msgs.length) return gmailError(res, 404, 'Requested entity was not found.')
        const format = url.searchParams.get('format') || 'full'
        const mh = url.searchParams.getAll('metadataHeaders')
        return send(res, 200, { id: thread[1], historyId: '1', messages: msgs.map((x) => render(x, format, mh)) })
      }

      if (route === 'labels') return send(res, 200, { labels: [] })

      return gmailError(res, 404, `mock gmail: ${req.method} ${route} not implemented`)
    } catch (err: any) {
      return gmailError(res, 500, err.message)
    }
  })
  await new Promise<void>((resolve) => server!.listen(PORTS.gmail, '127.0.0.1', resolve))
}

export async function stopGmailMock() {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
}
