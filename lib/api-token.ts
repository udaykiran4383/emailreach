import crypto from 'crypto'
import { cache } from 'react'
import { createClient, SupabaseClient, User } from '@supabase/supabase-js'
import { API_TOKEN_PREFIX } from '@/lib/api-token-routes'

/**
 * Personal API tokens (`erk_…`) for the MCP server and scripts. Only a
 * SHA-256 hash is stored; the token is shown once at creation.
 *
 * The middleware only lets tokens through on allowlisted routes
 * (lib/api-token-routes.ts), so it's safe for getUser() to accept one.
 */

let admin: SupabaseClient | null = null
function getAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || '', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return admin
}

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 10) }
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function extractBearerToken(authorization: string | null | undefined): string | null {
  const match = (authorization || '').match(/^Bearer\s+(erk_[A-Za-z0-9_-]{20,200})$/)
  return match ? match[1] : null
}

/** Looks up a token. Returns the owning user, or null. Memoized per request. */
export const resolveApiToken = cache(async (token: string): Promise<User | null> => {
  const db = getAdmin()
  const { data: row } = await db
    .from('api_tokens')
    .select('id, user_id')
    .eq('token_hash', hashApiToken(token))
    .maybeSingle()
  if (!row) return null

  // Best effort; never block the request on it
  db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {})

  const { data } = await db.auth.admin.getUserById(row.user_id)
  if (data?.user) return data.user
  // Personal-schema installs may use non-auth user ids: return a minimal user
  return { id: row.user_id, email: undefined, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' } as User
})

/** The token user for the current request, or null when the request has no API token. */
export async function getApiTokenUser(): Promise<User | null | undefined> {
  const { headers } = await import('next/headers')
  let authorization: string | null = null
  try {
    authorization = (await headers()).get('authorization')
  } catch {
    return undefined // outside a request (e.g. build time)
  }
  const token = extractBearerToken(authorization)
  if (!token) return undefined
  return resolveApiToken(token)
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/** Short-lived Supabase JWT for the user, so RLS applies as if they were logged in. */
function mintSupabaseJwt(userId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 300 }))
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

/**
 * Supabase client for a token-authenticated request. With SUPABASE_JWT_SECRET
 * set, it's an anon client carrying a minted user JWT (RLS enforced). Without
 * it, it falls back to the service-role client — acceptable only because the
 * allowlisted routes filter every query by the user's id.
 */
export function createClientForTokenUser(userId: string): SupabaseClient {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (secret) {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${mintSupabaseJwt(userId, secret)}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return getAdmin()
}

export async function createApiToken(userId: string, name: string): Promise<{ id: string; token: string; prefix: string; name: string; created_at: string }> {
  const { token, hash, prefix } = generateApiToken()
  const { data, error } = await getAdmin()
    .from('api_tokens')
    .insert({ user_id: userId, name: name.slice(0, 80) || 'API token', token_hash: hash, token_prefix: prefix })
    .select('id, name, created_at')
    .single()
  if (error || !data) throw new Error(error?.message || 'Could not create token')
  return { id: data.id, token, prefix, name: data.name, created_at: data.created_at }
}

export async function listApiTokens(userId: string) {
  const { data, error } = await getAdmin()
    .from('api_tokens')
    .select('id, name, token_prefix, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function deleteApiToken(userId: string, id: string): Promise<void> {
  const { error } = await getAdmin().from('api_tokens').delete().eq('id', id).eq('user_id', userId)
  if (error) throw new Error(error.message)
}
