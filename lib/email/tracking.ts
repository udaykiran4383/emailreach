import crypto from 'crypto'

/**
 * Open-tracking helpers. A recipient id is signed with HMAC so nobody can
 * forge opens for other recipients by guessing ids.
 */

function getSecret(): string {
  const secret = process.env.TRACKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('TRACKING_SECRET is not set')
  return secret
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url').slice(0, 22)
}

export function createTrackingToken(recipientId: string): string {
  const id = Buffer.from(recipientId).toString('base64url')
  return `${id}.${sign(recipientId)}`
}

/** Returns the recipient id, or null if the token is malformed or forged. */
export function verifyTrackingToken(token: string): string | null {
  const [id, sig] = token.replace(/\.gif$/, '').split('.')
  if (!id || !sig) return null
  let recipientId: string
  try {
    recipientId = Buffer.from(id, 'base64url').toString()
  } catch {
    return null
  }
  const expected = sign(recipientId)
  if (sig.length !== expected.length) return null
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? recipientId : null
}

/** Public base URL that recipients' mail clients can reach, or null when only localhost is configured. */
export function getPublicBaseUrl(): string | null {
  const base = (process.env.TRACKING_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || '').replace(/\/$/, '')
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return null
  return base
}

/**
 * Pixel URL for a recipient. Returns null when no public URL is configured:
 * a localhost pixel can never load for the recipient and only adds spam signals.
 */
export function createOpenTrackingUrl(recipientId: string): string | null {
  const base = getPublicBaseUrl()
  if (!base) return null
  return `${base}/api/track/open/${createTrackingToken(recipientId)}.gif`
}

// 1x1 transparent GIF
export const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
