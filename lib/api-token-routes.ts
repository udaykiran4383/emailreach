/**
 * Routes reachable with a personal API token (Authorization: Bearer erk_...).
 * Kept dependency-free so the middleware can import it.
 *
 * Only routes that scope every query by the authenticated user's id belong
 * here: with a token, the route's Supabase client acts on the user's behalf
 * (see lib/api-token.ts).
 */

export const API_TOKEN_PREFIX = 'erk_'

const ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/api\/campaigns$/ },
  { method: 'GET', pattern: /^\/api\/campaigns\/[^/]+\/analytics$/ },
  { method: 'POST', pattern: /^\/api\/campaigns\/[^/]+\/recipients$/ },
  { method: 'POST', pattern: /^\/api\/find-contacts$/ },
  { method: 'POST', pattern: /^\/api\/jobs\/search$/ },
  { method: 'GET', pattern: /^\/api\/pipeline$/ },
  { method: 'GET', pattern: /^\/api\/replies$/ },
]

export function isApiTokenRoute(method: string, pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/'
  return ROUTES.some((r) => r.method === method.toUpperCase() && r.pattern.test(path))
}
