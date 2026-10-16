import { NextResponse } from 'next/server'

/**
 * In-memory token bucket per user and route. Protects expensive endpoints
 * (crawling, AI calls) from runaway loops. Per server instance only — enough
 * for a personal deployment; use a shared store if you run many instances.
 */

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000

export interface RateLimitOptions {
  /** Requests allowed per window (bucket size) */
  limit?: number
  windowMs?: number
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export function rateLimit(userId: string, route: string, { limit = 30, windowMs = 60_000 }: RateLimitOptions = {}): NextResponse | null {
  if (process.env.RATE_LIMIT_DISABLED === '1') return null

  const key = `${route}:${userId}`
  const now = Date.now()
  const refillPerMs = limit / windowMs
  const bucket = buckets.get(key) || { tokens: limit, updatedAt: now }
  bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs)
  bucket.updatedAt = now

  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)
    return NextResponse.json(
      { error: 'Too many requests, slow down', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  bucket.tokens -= 1
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    // Drop the oldest entry (Map keeps insertion order)
    const oldest = buckets.keys().next().value
    if (oldest) buckets.delete(oldest)
  }
  buckets.set(key, bucket)
  return null
}
