/**
 * Test-only network redirection, loaded by instrumentation.ts in e2e runs (Node.js runtime only).
 * Routes Google API traffic and fixture company sites (*.test hosts) to local mocks.
 */
import http from 'node:http'
import https from 'node:https'

export function installE2eNetworkMocks() {
  const gmailMock = process.env.GMAIL_API_ROOT_URL
  const sitesMock = process.env.E2E_SITES_URL

  // googleapis -> gaxios -> node-fetch -> https.request: patch the builtin (shared across bundles)
  const GOOGLE_HOSTS = new Set(['gmail.googleapis.com', 'oauth2.googleapis.com', 'www.googleapis.com'])
  if (gmailMock) {
    const originalRequest = https.request
    const patched = function (this: unknown, ...args: any[]) {
      const [first, second, third] = args
      const target = typeof first === 'string' ? new URL(first) : first instanceof URL ? first : null
      if (target && GOOGLE_HOSTS.has(target.hostname)) {
        const rewritten = new URL(`${target.pathname}${target.search}`, gmailMock)
        const options = typeof second === 'object' && second ? { ...second, agent: undefined } : {}
        const callback = typeof second === 'function' ? second : third
        return http.request(rewritten, options, callback)
      }
      return (originalRequest as any).apply(this, args)
    }
    ;(https as any).request = patched
  }

  // Global fetch (undici): fixture company sites and one-click unsubscribe endpoints on *.test hosts
  if (sitesMock) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url
      let url: URL | null = null
      try {
        url = raw ? new URL(raw) : null
      } catch {
        url = null
      }
      if (url && url.hostname.endsWith('.test')) {
        const rewritten = new URL(`${url.pathname}${url.search}`, sitesMock)
        const headers = new Headers(init?.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined))
        headers.set('x-e2e-host', url.hostname)
        headers.set('x-e2e-proto', url.protocol.replace(':', ''))
        const method = init?.method || (typeof input === 'object' && !(input instanceof URL) ? input.method : undefined)
        return originalFetch(rewritten, { ...init, method, headers })
      }
      return originalFetch(input, init)
    }) as typeof fetch
  }
}
