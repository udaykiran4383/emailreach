import { createClient } from '@supabase/supabase-js'
import { getGmailForUser, hasModifyScope } from '@/lib/gmail/cleanup'
import { getPublicBaseUrl } from '@/lib/email/tracking'

/**
 * Setup / health checks shown on /dashboard/setup and as a banner on the dashboard.
 * Every check is best-effort: a failing probe becomes a check result, never a thrown error.
 */

// Service-role client: probes tables the user's key cannot read (sender_settings, app_heartbeats, ...)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export type HealthStatus = 'ok' | 'warn' | 'error' | 'info'
export type HealthGroup = 'database' | 'gmail' | 'background' | 'deliverability' | 'optional'

export interface HealthCheck {
  id: string
  group: HealthGroup
  label: string
  status: HealthStatus
  detail: string
  fix?: string
  link?: string
  copy?: string[] // env var names / SQL files the user can copy
}

export interface HealthReport {
  checks: HealthCheck[]
  summary: { ok: number; warn: number; error: number; info: number; total: number }
  checkedAt: string
}

const HEARTBEAT_KEY = 'cron'
const HEARTBEAT_STALE_MS = 5 * 60 * 1000

/**
 * Records that a background tick (/api/cron, driven by Chronos or any cron service) ran.
 * Never throws: a missing table (scripts/15_health.sql not run) must not break the cron run.
 */
export async function recordCronHeartbeat(detail?: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('app_heartbeats')
      .upsert({ key: HEARTBEAT_KEY, at: new Date().toISOString(), detail: detail ?? null }, { onConflict: 'key' })
    if (error) console.warn('[health] Failed to record cron heartbeat:', error.message)
  } catch (err) {
    console.warn('[health] Failed to record cron heartbeat:', err)
  }
}

export async function getCronHeartbeat(): Promise<{ at: string; detail: unknown } | null> {
  const { data, error } = await supabaseAdmin
    .from('app_heartbeats')
    .select('at, detail')
    .eq('key', HEARTBEAT_KEY)
    .maybeSingle()
  if (error || !data) return null
  return data
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ])
}

// ---------- Database ----------

interface MigrationProbe {
  file: string
  label: string
  table: string
  column: string
}

const MIGRATIONS: MigrationProbe[] = [
  { file: '08_deliverability_and_tracking.sql', label: 'Sending limits, open tracking, bounces', table: 'sender_settings', column: 'user_id' },
  { file: '09_jobs.sql', label: 'Hiring Now (saved jobs)', table: 'saved_jobs', column: 'id' },
  { file: '10_pipeline.sql', label: 'Application pipeline', table: 'applications', column: 'id' },
  { file: '11_sequences.sql', label: 'Multi-step sequences', table: 'campaign_steps', column: 'id' },
  { file: '12_ai.sql', label: 'Reply classification', table: 'email_replies', column: 'classification' },
  { file: '13_resume_links.sql', label: 'Resume links and API tokens', table: 'resume_links', column: 'id' },
  { file: '14_atomic_ops.sql', label: 'Atomic counters and reply sync cursor', table: 'sender_settings', column: 'last_reply_sync_at' },
  { file: '15_health.sql', label: 'Scheduler heartbeat', table: 'app_heartbeats', column: 'key' },
]

async function checkMigrations(): Promise<HealthCheck[]> {
  return Promise.all(
    MIGRATIONS.map(async (m): Promise<HealthCheck> => {
      const id = `migration-${m.file.slice(0, 2)}`
      try {
        const { error } = await supabaseAdmin.from(m.table).select(m.column).limit(0)
        if (!error) {
          return { id, group: 'database', label: m.label, status: 'ok', detail: `scripts/${m.file} applied` }
        }
        return {
          id,
          group: 'database',
          label: m.label,
          status: 'error',
          detail: `scripts/${m.file} has not been run (${error.message})`,
          fix: `Open the Supabase SQL Editor and run scripts/${m.file}. Run the files in number order.`,
          copy: [`scripts/${m.file}`],
        }
      } catch (err: any) {
        return {
          id,
          group: 'database',
          label: m.label,
          status: 'error',
          detail: `Could not reach the database: ${err?.message || err}`,
          fix: 'Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.',
          copy: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        }
      }
    })
  )
}

// ---------- Environment ----------

function checkEnv(): HealthCheck[] {
  const checks: HealthCheck[] = []
  const env = process.env

  const publicBase = getPublicBaseUrl()
  checks.push(
    publicBase
      ? { id: 'env-site-url', group: 'deliverability', label: 'Public site URL', status: 'ok', detail: `Tracking and resume links use ${publicBase}` }
      : {
          id: 'env-site-url',
          group: 'deliverability',
          label: 'Public site URL',
          status: 'warn',
          detail: 'No public URL configured, so open tracking and resume links are disabled.',
          fix: 'Set NEXT_PUBLIC_SITE_URL to the address recipients can reach (not localhost).',
          copy: ['NEXT_PUBLIC_SITE_URL'],
        }
  )

  checks.push(
    env.CRON_SECRET
      ? { id: 'env-cron-secret', group: 'background', label: 'Cron secret', status: 'ok', detail: 'CRON_SECRET is set' }
      : {
          id: 'env-cron-secret',
          group: 'background',
          label: 'Cron secret',
          status: 'error',
          detail: 'CRON_SECRET is not set: background sending cannot be authorized in production.',
          fix: 'Set CRON_SECRET in .env.local and the same value in scheduler/.env.',
          copy: ['CRON_SECRET'],
        }
  )

  checks.push(
    env.TRACKING_SECRET
      ? { id: 'env-tracking-secret', group: 'deliverability', label: 'Tracking secret', status: 'ok', detail: 'TRACKING_SECRET is set' }
      : {
          id: 'env-tracking-secret',
          group: 'deliverability',
          label: 'Tracking secret',
          status: 'warn',
          detail: 'Tracking and resume links are signed with the service role key as a fallback.',
          fix: 'Set TRACKING_SECRET to a long random string so the service key is never reused for signing.',
          copy: ['TRACKING_SECRET'],
        }
  )

  const aiEnabled = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) && env.AI_DISABLED !== 'true'
  checks.push(
    aiEnabled
      ? { id: 'env-ai', group: 'optional', label: 'AI (Claude)', status: 'ok', detail: 'Openers and reply classification use Claude' }
      : {
          id: 'env-ai',
          group: 'optional',
          label: 'AI (Claude)',
          status: 'warn',
          detail: 'AI is off: replies are sorted by keyword rules and openers cannot be generated.',
          fix: 'Set ANTHROPIC_API_KEY to enable AI openers and smarter reply sorting.',
          copy: ['ANTHROPIC_API_KEY'],
        }
  )

  const verifier = env.REACHER_URL
    ? 'Reacher'
    : env.EMAIL_VERIFIER_API_KEY
      ? 'MillionVerifier'
      : env.ENABLE_SMTP_VERIFY === 'true'
        ? 'local SMTP probe'
        : null
  checks.push(
    verifier
      ? { id: 'env-verifier', group: 'deliverability', label: 'Mailbox verification', status: 'ok', detail: `Mailboxes are confirmed with ${verifier}` }
      : {
          id: 'env-verifier',
          group: 'deliverability',
          label: 'Mailbox verification',
          status: 'warn',
          detail: 'MX-only verification: guessed emails stay risky and are not sent.',
          fix: 'Run Reacher (docker-compose.reacher.yml) on a host with port 25 open and set REACHER_URL, or set EMAIL_VERIFIER_API_KEY.',
          copy: ['REACHER_URL', 'EMAIL_VERIFIER_API_KEY'],
        }
  )

  checks.push(
    env.HUNTER_API_KEY
      ? { id: 'env-hunter', group: 'optional', label: 'Hunter.io', status: 'ok', detail: 'Hunter is used when finding contacts' }
      : {
          id: 'env-hunter',
          group: 'optional',
          label: 'Hunter.io',
          status: 'info',
          detail: 'Optional: adds department search when finding HR and leaders.',
          fix: 'Set HUNTER_API_KEY if you have a Hunter.io account.',
          copy: ['HUNTER_API_KEY'],
        }
  )

  return checks
}

// ---------- Gmail ----------

async function checkGmail(userId: string): Promise<{ checks: HealthCheck[]; email: string | null }> {
  let ctx: Awaited<ReturnType<typeof getGmailForUser>>
  try {
    ctx = await getGmailForUser(userId)
  } catch {
    return {
      email: null,
      checks: [
        {
          id: 'gmail-connected',
          group: 'gmail',
          label: 'Gmail connected',
          status: 'error',
          detail: 'No Gmail account is connected, so nothing can be sent.',
          fix: 'Connect your Gmail account in Gmail Settings.',
          link: '/dashboard/settings',
        },
      ],
    }
  }

  const checks: HealthCheck[] = []
  try {
    const profile = await withTimeout(ctx.gmail.users.getProfile({ userId: 'me' }), 8000, 'Gmail')
    checks.push({
      id: 'gmail-connected',
      group: 'gmail',
      label: 'Gmail connected',
      status: 'ok',
      detail: `Sending as ${profile.data.emailAddress || ctx.email}`,
    })
  } catch (err: any) {
    checks.push({
      id: 'gmail-connected',
      group: 'gmail',
      label: 'Gmail connected',
      status: 'error',
      detail: `Gmail rejected the saved token (${err?.message || 'unknown error'}).`,
      fix: 'Reconnect Gmail in Gmail Settings.',
      link: '/dashboard/settings',
    })
    return { checks, email: ctx.email }
  }

  try {
    const canModify = await withTimeout(hasModifyScope(ctx), 8000, 'Token info')
    checks.push(
      canModify
        ? { id: 'gmail-scope', group: 'gmail', label: 'Inbox Cleanup permission', status: 'ok', detail: 'gmail.modify granted' }
        : {
            id: 'gmail-scope',
            group: 'gmail',
            label: 'Inbox Cleanup permission',
            status: 'warn',
            detail: 'The token is missing gmail.modify, so Inbox Cleanup cannot move mail to Trash.',
            fix: 'Reconnect for Inbox Cleanup: add gmail.modify to the OAuth consent screen, then reconnect Gmail.',
            link: '/dashboard/settings',
          }
    )
  } catch (err: any) {
    checks.push({
      id: 'gmail-scope',
      group: 'gmail',
      label: 'Inbox Cleanup permission',
      status: 'warn',
      detail: `Could not read the token's permissions (${err?.message || 'unknown error'}).`,
      fix: 'Reconnect Gmail in Gmail Settings if Inbox Cleanup fails.',
      link: '/dashboard/settings',
    })
  }

  return { checks, email: ctx.email }
}

// ---------- Background sending ----------

async function checkBackground(userId: string): Promise<HealthCheck[]> {
  const heartbeat = await getCronHeartbeat()
  const ageMs = heartbeat ? Date.now() - new Date(heartbeat.at).getTime() : null
  const fresh = ageMs !== null && ageMs < HEARTBEAT_STALE_MS

  const checks: HealthCheck[] = []
  checks.push(
    fresh
      ? {
          id: 'cron-heartbeat',
          group: 'background',
          label: 'Background scheduler',
          status: 'ok',
          detail: `Last tick ${Math.max(0, Math.round((ageMs as number) / 1000))}s ago`,
        }
      : {
          id: 'cron-heartbeat',
          group: 'background',
          label: 'Background scheduler',
          status: 'warn',
          detail: heartbeat
            ? `Last tick was ${formatAge(ageMs as number)} ago: scheduled campaigns only send while this page is open.`
            : 'The scheduler has never run: scheduled campaigns only send while the campaign page is open.',
          fix: 'Run npm run scheduler:lite (or point any cron service at /api/cron every minute).',
          copy: ['npm run scheduler:lite'],
        }
  )

  if (!fresh) {
    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, name')
      .eq('user_id', userId)
      .in('status', ['scheduled', 'sending'])

    if (campaigns?.length) {
      const { count } = await supabaseAdmin
        .from('email_recipients')
        .select('id', { count: 'exact', head: true })
        .in('campaign_id', campaigns.map(c => c.id))
        .eq('status', 'pending')

      if ((count || 0) > 0) {
        checks.push({
          id: 'cron-stalled-campaigns',
          group: 'background',
          label: 'Scheduled campaigns are stalled',
          status: 'error',
          detail: `${count} email${count === 1 ? ' is' : 's are'} waiting in ${campaigns.length} scheduled campaign${campaigns.length === 1 ? '' : 's'}, but the scheduler is not running.`,
          fix: 'Start the scheduler with npm run scheduler:lite, or open the campaign and press Resume.',
          copy: ['npm run scheduler:lite'],
          link: '/dashboard/campaigns',
        })
      }
    }
  }

  return checks
}

function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} days`
}

// ---------- Deliverability ----------

async function checkDeliverability(userId: string, senderEmail: string | null): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = []
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [sent, bounced] = await Promise.all([
    supabaseAdmin
      .from('email_recipients')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .gte('sent_at', since),
    supabaseAdmin
      .from('email_recipients')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .eq('status', 'bounced')
      .gte('sent_at', since),
  ])

  const sentCount = sent.count || 0
  const bouncedCount = bounced.count || 0
  const rate = sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0
  const rateText = `${rate.toFixed(1)}% (${bouncedCount} of ${sentCount} in the last 7 days)`

  checks.push(
    sentCount === 0
      ? { id: 'bounce-rate', group: 'deliverability', label: 'Bounce rate', status: 'ok', detail: 'Nothing sent in the last 7 days' }
      : rate > 3
        ? {
            id: 'bounce-rate',
            group: 'deliverability',
            label: 'Bounce rate',
            status: 'error',
            detail: `Bounce rate ${rateText}. Gmail flags accounts with high bounce rates.`,
            fix: 'Stop sending, verify your lists (Recipients → Verify emails), and only send to verified-safe addresses.',
          }
        : rate > 2
          ? {
              id: 'bounce-rate',
              group: 'deliverability',
              label: 'Bounce rate',
              status: 'warn',
              detail: `Bounce rate ${rateText}.`,
              fix: 'Verify lists before sending and remove guessed addresses.',
            }
          : { id: 'bounce-rate', group: 'deliverability', label: 'Bounce rate', status: 'ok', detail: `Bounce rate ${rateText}` }
  )

  const { data: settings } = await supabaseAdmin
    .from('sender_settings')
    .select('daily_limit')
    .eq('user_id', userId)
    .maybeSingle()

  const dailyLimit = settings?.daily_limit as number | undefined
  const isGmailCom = senderEmail ? /@(gmail|googlemail)\.com$/i.test(senderEmail) : false
  if (dailyLimit !== undefined) {
    checks.push(
      isGmailCom && dailyLimit > 100
        ? {
            id: 'daily-limit',
            group: 'deliverability',
            label: 'Daily sending limit',
            status: 'warn',
            detail: `${dailyLimit} emails/day is high for a free gmail.com account doing cold outreach.`,
            fix: 'Lower the daily limit to 50 or less in Settings → Sending Limits.',
            link: '/dashboard/settings',
          }
        : { id: 'daily-limit', group: 'deliverability', label: 'Daily sending limit', status: 'ok', detail: `${dailyLimit} emails/day` }
    )
  }

  return checks
}

// ---------- Report ----------

export async function runHealthChecks(userId: string): Promise<HealthReport> {
  const settle = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      console.warn('[health] check failed:', err)
      return fallback
    }
  }

  const [migrations, gmail, background] = await Promise.all([
    settle(checkMigrations, []),
    settle(() => checkGmail(userId), { checks: [], email: null }),
    settle(() => checkBackground(userId), []),
  ])
  const deliverability = await settle(() => checkDeliverability(userId, gmail.email), [])

  const checks = [...migrations, ...gmail.checks, ...background, ...deliverability, ...checkEnv()]
  const summary = { ok: 0, warn: 0, error: 0, info: 0, total: checks.length }
  for (const c of checks) summary[c.status]++

  return { checks, summary, checkedAt: new Date().toISOString() }
}
