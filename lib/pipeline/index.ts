import { createClient } from '@supabase/supabase-js'
import { Stage, STAGES, nextStage } from './stages'

export type { Stage } from './stages'
export { STAGES, STAGE_LABELS, nextStage, isStage, stageAtLeast } from './stages'

/**
 * Application pipeline (company → contacted → replied → interview → offer / rejected).
 * Server-only: tables have RLS enabled with no policies, so every call uses the service role.
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export type ActivityKind = 'stage_change' | 'note' | 'email_sent' | 'reply' | 'system'

export interface Application {
  id: string
  user_id: string
  company: string
  domain: string
  job_title: string | null
  job_url: string | null
  stage: Stage
  source: string | null
  notes: string | null
  next_step: string | null
  next_step_at: string | null
  created_at: string
  updated_at: string
  stage_changed_at: string | null
}

export interface ApplicationContact {
  email: string
  name: string | null
  status: string
  opened_at: string | null
  replied_at: string | null
  campaign_name: string | null
}

const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'me.com', 'protonmail.com', 'proton.me', 'rediffmail.com', 'aol.com',
])

/** Lowercased bare domain from a domain, URL or email address. */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase()
  if (value.includes('@') && !value.includes('/')) value = value.split('@').pop() || ''
  value = value.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '')
  return value.replace(/^www\./, '')
}

export function companyFromDomain(domain: string): string {
  const label = domain.split('.')[0] || domain
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function isFreeProviderDomain(domain: string): boolean {
  return FREE_PROVIDERS.has(domain)
}

export async function logActivity(
  applicationId: string,
  userId: string,
  kind: ActivityKind,
  message: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('application_activity')
    .insert({ application_id: applicationId, user_id: userId, kind, message })
  if (error) console.warn('[pipeline] activity insert failed:', error.message)
}

async function findApplication(userId: string, domain: string, jobUrl: string | null) {
  let query = supabaseAdmin
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('domain', domain)
  query = jobUrl ? query.eq('job_url', jobUrl) : query.is('job_url', null)
  const { data } = await query.limit(1).maybeSingle()
  return data as Application | null
}

/**
 * Create or update an application. Unique per (user, domain, job url);
 * an upsert never moves the stage backwards.
 */
export async function upsertApplication(
  userId: string,
  input: { company: string; domain: string; jobTitle?: string; jobUrl?: string; stage?: Stage; source?: string }
): Promise<{ id: string }> {
  const domain = normalizeDomain(input.domain)
  if (!domain) throw new Error('Domain is required')
  const jobUrl = input.jobUrl?.trim() || null
  const now = new Date().toISOString()

  const existing = await findApplication(userId, domain, jobUrl)
  if (existing) {
    const update: Record<string, unknown> = { updated_at: now }
    if (input.jobTitle && !existing.job_title) update.job_title = input.jobTitle
    if (input.company && (!existing.company || existing.company === companyFromDomain(domain))) {
      update.company = input.company
    }
    if (input.stage) {
      const stage = nextStage(existing.stage, input.stage)
      if (stage !== existing.stage) {
        update.stage = stage
        update.stage_changed_at = now
      }
    }
    const { error } = await supabaseAdmin.from('applications').update(update).eq('id', existing.id)
    if (error) throw new Error(error.message)
    if (update.stage) {
      await logActivity(existing.id, userId, 'stage_change', `Moved from ${existing.stage} to ${update.stage}`)
    }
    return { id: existing.id }
  }

  const stage = input.stage || 'target'
  const { data, error } = await supabaseAdmin
    .from('applications')
    .insert({
      user_id: userId,
      company: input.company?.trim() || companyFromDomain(domain),
      domain,
      job_title: input.jobTitle || null,
      job_url: jobUrl,
      stage,
      source: input.source || null,
      stage_changed_at: now,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Lost a race with a concurrent insert: the unique index caught it, read the winner
    const raced = await findApplication(userId, domain, jobUrl)
    if (raced) return { id: raced.id }
    throw new Error(error?.message || 'Failed to create application')
  }

  await logActivity(data.id, userId, 'system', `Added to pipeline as ${stage}${input.source ? ` (${input.source})` : ''}`)
  return { id: data.id }
}

/**
 * Move the application for an email's company forward (used by sending, reply sync and
 * reply classification). Personal-provider addresses (gmail.com etc.) are ignored: the
 * domain says nothing about the company.
 */
export async function advanceStageByEmail(
  userId: string,
  email: string,
  stage: 'contacted' | 'replied' | 'interview' | 'offer' | 'rejected',
  note?: string
): Promise<void> {
  const domain = normalizeDomain(email)
  if (!domain || isFreeProviderDomain(domain)) return

  // Prefer the general (no job url) application; fall back to any application for the domain
  const { data: apps } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .eq('domain', domain)
    .order('created_at', { ascending: true })

  let app = (apps as Application[] | null)?.find((a) => !a.job_url) || (apps as Application[] | null)?.[0] || null

  if (!app) {
    const company = await companyForEmail(userId, email)
    const { id } = await upsertApplication(userId, { company: company || companyFromDomain(domain), domain, stage, source: 'campaign' })
    if (note) await logActivity(id, userId, stage === 'replied' ? 'reply' : 'system', note)
    return
  }

  const target = nextStage(app.stage, stage)
  const now = new Date().toISOString()
  if (target !== app.stage) {
    const { error } = await supabaseAdmin
      .from('applications')
      .update({ stage: target, stage_changed_at: now, updated_at: now })
      .eq('id', app.id)
    if (error) throw new Error(error.message)
    await logActivity(app.id, userId, 'stage_change', `Moved from ${app.stage} to ${target}${note ? `: ${note}` : ''}`)
  } else if (note) {
    await logActivity(app.id, userId, stage === 'replied' ? 'reply' : 'system', note)
  }
}

async function companyForEmail(userId: string, email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('email_recipients')
    .select('company, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .ilike('email', email.trim())
    .not('company', 'is', null)
    .limit(1)
  return (data?.[0] as { company?: string } | undefined)?.company || null
}

/** All recipients of the user's campaigns, keyed by email domain. */
export async function getContactsByDomain(userId: string, domains?: string[]): Promise<Map<string, ApplicationContact[]>> {
  const map = new Map<string, ApplicationContact[]>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('email_recipients')
      .select('email, name, status, opened_at, replied_at, campaigns!inner(user_id, name)')
      .eq('campaigns.user_id', userId)
      .range(from, from + pageSize - 1)
    if (error) {
      // opened_at arrives with migration 08; retry without it on older databases
      if (/opened_at/.test(error.message)) return getContactsByDomainLegacy(userId, domains)
      throw new Error(error.message)
    }
    for (const row of (data || []) as any[]) {
      const domain = normalizeDomain(row.email || '')
      if (!domain || (domains && !domains.includes(domain))) continue
      const list = map.get(domain) || []
      list.push({
        email: row.email,
        name: row.name,
        status: row.status,
        opened_at: row.opened_at ?? null,
        replied_at: row.replied_at ?? null,
        campaign_name: row.campaigns?.name ?? null,
      })
      map.set(domain, list)
    }
    if (!data || data.length < pageSize) break
  }
  return map
}

async function getContactsByDomainLegacy(userId: string, domains?: string[]) {
  const map = new Map<string, ApplicationContact[]>()
  const { data } = await supabaseAdmin
    .from('email_recipients')
    .select('email, name, status, replied_at, campaigns!inner(user_id, name)')
    .eq('campaigns.user_id', userId)
  for (const row of (data || []) as any[]) {
    const domain = normalizeDomain(row.email || '')
    if (!domain || (domains && !domains.includes(domain))) continue
    const list = map.get(domain) || []
    list.push({ email: row.email, name: row.name, status: row.status, opened_at: null, replied_at: row.replied_at ?? null, campaign_name: row.campaigns?.name ?? null })
    map.set(domain, list)
  }
  return map
}

export async function listApplications(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  const applications = (data || []) as Application[]

  const contactsByDomain = await getContactsByDomain(userId)

  // Latest activity per application, for the card's "last activity" line
  const ids = applications.map((a) => a.id)
  const lastActivity = new Map<string, { message: string; created_at: string }>()
  if (ids.length > 0) {
    const { data: activity } = await supabaseAdmin
      .from('application_activity')
      .select('application_id, message, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(2000)
    for (const row of activity || []) {
      if (!lastActivity.has(row.application_id)) lastActivity.set(row.application_id, row)
    }
  }

  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>
  for (const app of applications) counts[app.stage] = (counts[app.stage] || 0) + 1

  return {
    applications: applications.map((app) => ({
      ...app,
      contacts: contactsByDomain.get(app.domain) || [],
      last_activity: lastActivity.get(app.id) || null,
    })),
    counts,
  }
}

export async function getApplication(userId: string, id: string) {
  const { data: app } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!app) return null

  const [{ data: activity }, contactsByDomain] = await Promise.all([
    supabaseAdmin
      .from('application_activity')
      .select('*')
      .eq('application_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    getContactsByDomain(userId, [(app as Application).domain]),
  ])

  return {
    application: app as Application,
    activity: activity || [],
    contacts: contactsByDomain.get((app as Application).domain) || [],
  }
}

export async function updateApplication(
  userId: string,
  id: string,
  patch: { stage?: Stage; notes?: string | null; next_step?: string | null; next_step_at?: string | null; company?: string; job_title?: string | null }
) {
  const { data: existing } = await supabaseAdmin
    .from('applications')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!existing) return null

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }
  for (const key of ['notes', 'next_step', 'next_step_at', 'company', 'job_title'] as const) {
    if (key in patch) update[key] = patch[key]
  }
  // Manual moves may go in any direction (the user knows best)
  const stageChanged = patch.stage && patch.stage !== existing.stage
  if (stageChanged) {
    update.stage = patch.stage
    update.stage_changed_at = now
  }

  const { data, error } = await supabaseAdmin
    .from('applications')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  if (stageChanged) await logActivity(id, userId, 'stage_change', `Moved from ${existing.stage} to ${patch.stage}`)
  if ('notes' in patch && patch.notes !== existing.notes) await logActivity(id, userId, 'note', 'Notes updated')
  if ('next_step' in patch && patch.next_step && patch.next_step !== existing.next_step) {
    await logActivity(id, userId, 'note', `Next step: ${patch.next_step}`)
  }
  return data as Application
}

export async function deleteApplication(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('applications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.length || 0) > 0
}

/**
 * Backfill the board from existing campaigns: sent → at least contacted, replied → at least replied.
 * Returns how many applications were created or advanced.
 */
export async function syncFromCampaigns(userId: string): Promise<{ processed: number; domains: number }> {
  const { data, error } = await supabaseAdmin
    .from('email_recipients')
    .select('email, company, status, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .in('status', ['sent', 'replied'])
  if (error) throw new Error(error.message)

  // One target stage per domain (replied beats sent)
  const byDomain = new Map<string, { stage: 'contacted' | 'replied'; company: string | null; email: string }>()
  for (const row of (data || []) as any[]) {
    const domain = normalizeDomain(row.email || '')
    if (!domain || isFreeProviderDomain(domain)) continue
    const stage = row.status === 'replied' ? 'replied' : 'contacted'
    const current = byDomain.get(domain)
    if (!current || (stage === 'replied' && current.stage !== 'replied')) {
      byDomain.set(domain, { stage, company: row.company || current?.company || null, email: row.email })
    } else if (!current.company && row.company) {
      current.company = row.company
    }
  }

  let processed = 0
  for (const [domain, info] of byDomain) {
    await upsertApplication(userId, {
      company: info.company || companyFromDomain(domain),
      domain,
      stage: info.stage,
      source: 'campaign',
    })
    processed++
  }
  return { processed, domains: byDomain.size }
}
