import crypto from 'crypto'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getPublicBaseUrl } from '@/lib/email/tracking'
import { mergeRecipientVariables } from '@/lib/db/atomic'

/**
 * Tracked resume links. Cold emails carry {{resume_url}} instead of a PDF
 * attachment (attachments are a strong spam signal), and each recipient gets
 * a signed URL so we can tell who opened the resume.
 */

let admin: SupabaseClient | null = null
function getAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  }
  return admin
}

function getSecret(): string {
  const secret = process.env.TRACKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('TRACKING_SECRET is not set')
  return secret
}

function sign(value: string): string {
  // Domain-separated from open-tracking tokens so one can't be replayed as the other
  return crypto.createHmac('sha256', getSecret()).update(`resume:${value}`).digest('base64url').slice(0, 22)
}

/** recipientId may be empty for a generic (unattributed) link. */
export function createResumeToken(linkId: string, recipientId = ''): string {
  const payload = `${linkId}.${recipientId}`
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
}

export function verifyResumeToken(token: string): { linkId: string; recipientId: string | null } | null {
  const [encoded, sig] = token.split('.')
  if (!encoded || !sig) return null
  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString()
  } catch {
    return null
  }
  const expected = sign(payload)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const [linkId, recipientId] = payload.split('.')
  if (!linkId) return null
  return { linkId, recipientId: recipientId || null }
}

/** Public URL for a recipient, or null when no public site URL is configured. */
export function createResumeUrl(linkId: string, recipientId = ''): string | null {
  const base = getPublicBaseUrl()
  if (!base) return null
  return `${base}/r/${createResumeToken(linkId, recipientId)}`
}

/** Link scanners (Safe Links, Proofpoint…), previews and bots: logged but excluded from stats. */
export function isAutomatedViewer(ua: string): boolean {
  return /bot|crawler|spider|preview|slurp|facebookexternalhit|linkedinbot|safelinks|barracuda|proofpoint|mimecast|googleimageproxy|yahoomailproxy|headless|python-requests|curl|wget/i.test(ua)
}

export interface ResumeLink {
  id: string
  user_id: string
  campaign_id: string | null
  storage_path: string
  filename: string
  created_at: string
}

/** Creates (or returns the existing) link for a campaign's resume. */
export async function getOrCreateCampaignLink(userId: string, campaign: { id: string; resume_storage_path: string | null }): Promise<ResumeLink> {
  if (!campaign.resume_storage_path) throw new Error('This campaign has no resume uploaded')
  const db = getAdmin()

  const { data: existing } = await db.from('resume_links').select('*').eq('campaign_id', campaign.id).maybeSingle()
  const filename = (campaign.resume_storage_path.split('/').pop() || 'resume.pdf').replace(/^\d+_/, '')

  if (existing) {
    // Resume re-uploaded since: point the link at the new file
    if (existing.storage_path !== campaign.resume_storage_path) {
      const { data: updated } = await db
        .from('resume_links')
        .update({ storage_path: campaign.resume_storage_path, filename })
        .eq('id', existing.id)
        .select()
        .single()
      return (updated || existing) as ResumeLink
    }
    return existing as ResumeLink
  }

  const { data, error } = await db
    .from('resume_links')
    .insert({ user_id: userId, campaign_id: campaign.id, storage_path: campaign.resume_storage_path, filename })
    .select()
    .single()
  if (error?.code === '23505') {
    // A concurrent request (double click, page loading twice) created it first: use that one
    const { data: raced } = await db.from('resume_links').select('*').eq('campaign_id', campaign.id).single()
    if (raced) return raced as ResumeLink
  }
  if (error || !data) throw new Error(error?.message || 'Could not create resume link')
  return data as ResumeLink
}

/**
 * Resume URL for one recipient of a campaign, or null when the campaign has
 * no resume link / no public URL. Use at send time for recipients added after
 * the link was enabled.
 */
export async function getResumeUrlForRecipient(campaignId: string, recipientId: string): Promise<string | null> {
  const { data } = await getAdmin().from('resume_links').select('id').eq('campaign_id', campaignId).maybeSingle()
  return data ? createResumeUrl(data.id, recipientId) : null
}

/** Writes variables.resume_url on every recipient of the campaign (merging other keys). */
export async function writeResumeUrls(campaignId: string, linkId: string): Promise<number> {
  const db = getAdmin()
  const { data: recipients, error } = await db
    .from('email_recipients')
    .select('id')
    .eq('campaign_id', campaignId)
  if (error) throw new Error(error.message)

  let updated = 0
  const rows = recipients || []
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20)
    await Promise.all(chunk.map(async (r: { id: string }) => {
      const url = createResumeUrl(linkId, r.id)
      if (!url) return
      try {
        await mergeRecipientVariables(r.id, { resume_url: url })
        updated++
      } catch {
        // counted as not updated
      }
    }))
  }
  return updated
}

export interface ResumeViewStat {
  recipientId: string | null
  email: string | null
  name: string | null
  views: number
  firstViewedAt: string
  lastViewedAt: string
}

/** Human views per recipient (automated viewers excluded). */
export async function getResumeViewStats(linkId: string): Promise<{ totalViews: number; uniqueViewers: number; viewers: ResumeViewStat[] }> {
  const db = getAdmin()
  const { data: views, error } = await db
    .from('resume_views')
    .select('recipient_id, viewed_at')
    .eq('link_id', linkId)
    .eq('is_proxy', false)
    .order('viewed_at', { ascending: true })
    .limit(5000)
  if (error) throw new Error(error.message)

  const byRecipient = new Map<string, ResumeViewStat>()
  for (const v of views || []) {
    const key = v.recipient_id || 'unknown'
    const stat = byRecipient.get(key)
    if (stat) {
      stat.views++
      stat.lastViewedAt = v.viewed_at
    } else {
      byRecipient.set(key, { recipientId: v.recipient_id, email: null, name: null, views: 1, firstViewedAt: v.viewed_at, lastViewedAt: v.viewed_at })
    }
  }

  const ids = [...byRecipient.values()].map((s) => s.recipientId).filter(Boolean) as string[]
  if (ids.length > 0) {
    const { data: recipients } = await db.from('email_recipients').select('id, email, name').in('id', ids)
    for (const r of recipients || []) {
      const stat = byRecipient.get(r.id)
      if (stat) {
        stat.email = r.email
        stat.name = r.name
      }
    }
  }

  const viewers = [...byRecipient.values()].sort((a, b) => b.lastViewedAt.localeCompare(a.lastViewedAt))
  return {
    totalViews: viewers.reduce((n, v) => n + v.views, 0),
    uniqueViewers: viewers.filter((v) => v.recipientId).length,
    viewers,
  }
}

/** Records a view. Returns the link so the caller can stream the file. */
export async function recordResumeView(linkId: string, recipientId: string | null, ua: string): Promise<ResumeLink | null> {
  const db = getAdmin()
  const { data: link } = await db.from('resume_links').select('*').eq('id', linkId).maybeSingle()
  if (!link) return null

  let validRecipient = recipientId
  let skip = false
  if (recipientId) {
    const { data: recipient } = await db
      .from('email_recipients')
      .select('id, campaign_id, sent_at')
      .eq('id', recipientId)
      .maybeSingle()
    if (!recipient || recipient.campaign_id !== link.campaign_id) {
      validRecipient = null
    } else if (recipient.sent_at && Date.now() - new Date(recipient.sent_at).getTime() < 10_000) {
      // Rendered/scanned while the email was being sent: not a real view
      skip = true
    }
  }

  if (!skip) {
    const { error } = await db.from('resume_views').insert({
      link_id: linkId,
      recipient_id: validRecipient,
      ua: ua.slice(0, 500),
      is_proxy: isAutomatedViewer(ua),
    })
    if (error) console.warn('[resume-links] Failed to record view:', error.message)
  }

  return link as ResumeLink
}
