import dns from 'dns'
import http from 'http'
import https from 'https'
import net from 'net'
import zlib from 'zlib'
import type { LookupFunction } from 'net'

/**
 * Outbound HTTP(S) to user-supplied URLs without SSRF via DNS rebinding:
 * the hostname is resolved once, every address is checked, and the socket is
 * pinned to that validated address (Host header and TLS SNI keep the hostname).
 */

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip)
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower)
}

/** End-to-end tests serve fixture sites locally; never honored in production builds. */
export function privateFetchAllowedForTests(): boolean {
  return process.env.E2E_ALLOW_PRIVATE_FETCH === '1' && process.env.NODE_ENV !== 'production'
}

export interface ValidatedAddress {
  address: string
  family: 4 | 6
}

/** Throws for non-http(s) URLs and private/internal hosts; returns the address to connect to. */
export async function resolvePublicAddress(url: URL): Promise<ValidatedAddress> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http/https URLs are allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private hosts are not allowed')
  }
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }]
    : await dns.promises.lookup(host, { all: true })
  if (addresses.length === 0 || addresses.some((a) => isPrivateIP(a.address))) {
    throw new Error('Private/internal addresses are not allowed')
  }
  // IPv4 first: many home/office networks resolve AAAA records but have no IPv6 route
  const first = addresses.find((a) => a.family === 4) || addresses[0]
  return { address: first.address, family: first.family === 6 ? 6 : 4 }
}

// A socket can still fail to connect after its request was destroyed (overall deadline hit
// mid-connect); nothing listens then and the process crashes. The request reports its own
// errors, so every socket gets a no-op listener at creation.
function guardSocket<T extends { on(event: 'error', fn: () => void): unknown } | undefined | null>(socket: T): T {
  socket?.on('error', () => {})
  return socket
}
class GuardedHttpAgent extends http.Agent {
  createConnection(...args: Parameters<http.Agent['createConnection']>) {
    return guardSocket(super.createConnection(...args))
  }
}
class GuardedHttpsAgent extends https.Agent {
  createConnection(...args: Parameters<https.Agent['createConnection']>) {
    return guardSocket(super.createConnection(...args))
  }
}
const httpAgent = new GuardedHttpAgent()
const httpsAgent = new GuardedHttpsAgent()

export interface SafeResponse {
  status: number
  headers: Record<string, string>
  body: string
  truncated: boolean
}

export interface SafeRequestOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  /** Skip reading the body (status-only requests) */
  discardBody?: boolean
}

/** Single request, no redirect following (callers re-validate each hop). */
export async function safeRequest(url: URL, options: SafeRequestOptions = {}): Promise<SafeResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024, discardBody } = options

  if (privateFetchAllowedForTests()) {
    return viaFetch(url, { method, headers, body, timeoutMs, maxBytes, discardBody })
  }

  const pinned = await resolvePublicAddress(url)
  // Always answer with the validated address, whatever form of lookup the socket asks for
  const lookup = ((_host: string, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : cb
    if (opts && typeof opts === 'object' && opts.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }])
    } else {
      callback(null, pinned.address, pinned.family)
    }
  }) as LookupFunction

  const transport = url.protocol === 'https:' ? https : http
  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  return new Promise<SafeResponse>((resolveOuter, rejectOuter) => {
    // `timeout` below is socket idle time; this is the overall deadline
    const deadline = setTimeout(() => req.destroy(new Error('Request timed out')), timeoutMs)
    const resolve = (value: SafeResponse) => {
      clearTimeout(deadline)
      resolveOuter(value)
    }
    const reject = (err: unknown) => {
      clearTimeout(deadline)
      rejectOuter(err)
    }
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        lookup,
        agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
        servername: net.isIP(hostname) ? undefined : hostname,
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
          ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const responseHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined) responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
        }
        const status = res.statusCode || 0
        if (discardBody || (method === 'POST' && status >= 300 && status < 400)) {
          res.resume()
          resolve({ status, headers: responseHeaders, body: '', truncated: false })
          return
        }

        const encoding = (responseHeaders['content-encoding'] || '').toLowerCase()
        let stream: NodeJS.ReadableStream = res
        if (encoding.includes('gzip')) stream = res.pipe(zlib.createGunzip())
        else if (encoding.includes('deflate')) stream = res.pipe(zlib.createInflate())
        else if (encoding.includes('br')) stream = res.pipe(zlib.createBrotliDecompress())

        const chunks: Buffer[] = []
        let total = 0
        let truncated = false
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return
          total += chunk.length
          if (total > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (total - maxBytes)))
            truncated = true
            res.destroy()
            resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks).toString('utf8'), truncated })
            return
          }
          chunks.push(chunk)
        })
        stream.on('end', () => {
          if (!truncated) resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks).toString('utf8'), truncated })
        })
        stream.on('error', (err) => {
          if (!truncated) reject(err)
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function viaFetch(
  url: URL,
  { method, headers, body, timeoutMs, maxBytes, discardBody }: Required<Pick<SafeRequestOptions, 'method' | 'headers' | 'timeoutMs' | 'maxBytes'>> &
    Pick<SafeRequestOptions, 'body' | 'discardBody'>
): Promise<SafeResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, redirect: 'manual', signal: controller.signal })
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value
    })
    if (discardBody || !res.body) {
      await res.body?.cancel()
      return { status: res.status, headers: responseHeaders, body: '', truncated: false }
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let truncated = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        chunks.push(value.slice(0, value.byteLength - (total - maxBytes)))
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
    return {
      status: res.status,
      headers: responseHeaders,
      body: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
      truncated,
    }
  } finally {
    clearTimeout(timer)
  }
}
