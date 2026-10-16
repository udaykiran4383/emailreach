import { createClient } from '@supabase/supabase-js'

/**
 * Sending guard rails that keep a personal Gmail account out of trouble:
 * daily caps with warm-up, random gaps between emails, a sending window,
 * and an automatic pause when too many emails bounce.
 */

// Service-role client: sender_settings is not readable with the user's key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export interface SenderSettings {
  user_id: string
  daily_limit: number
  warmup_enabled: boolean
  warmup_start: number
  warmup_increment: number
  min_delay_seconds: number
  max_delay_seconds: number
  send_window_start: number
  send_window_end: number
  skip_weekends: boolean
  timezone: string
  max_bounce_rate: number
  use_recipient_timezone: boolean // send in each recipient's local hours (scripts/11_sequences.sql)
  next_send_at: string | null
}

export const DEFAULT_SENDER_SETTINGS: Omit<SenderSettings, 'user_id' | 'next_send_at'> = {
  daily_limit: 50,
  warmup_enabled: true,
  warmup_start: 15,
  warmup_increment: 5,
  min_delay_seconds: 60,
  max_delay_seconds: 150,
  send_window_start: 9,
  send_window_end: 18,
  skip_weekends: true,
  timezone: 'Asia/Kolkata',
  max_bounce_rate: 3,
  use_recipient_timezone: false,
}

export type SenderSettingsPatch = Partial<Omit<SenderSettings, 'user_id' | 'next_send_at'>>

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export async function getSenderSettings(userId: string): Promise<SenderSettings> {
  const { data } = await supabaseAdmin
    .from('sender_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (data) return { ...DEFAULT_SENDER_SETTINGS, ...data, max_bounce_rate: Number(data.max_bounce_rate) }

  const { data: created, error } = await supabaseAdmin
    .from('sender_settings')
    .upsert({ user_id: userId, ...DEFAULT_SENDER_SETTINGS }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error || !created) {
    // Without this table there is no send gate, so refuse to send rather than blast
    throw new Error(
      `Sending limits unavailable (${error?.message || 'unknown error'}). Run scripts/08_deliverability_and_tracking.sql in Supabase.`
    )
  }
  return { ...created, max_bounce_rate: Number(created.max_bounce_rate) }
}

export async function updateSenderSettings(userId: string, patch: SenderSettingsPatch): Promise<SenderSettings> {
  const current = await getSenderSettings(userId)
  const merged = { ...current, ...patch }

  const minDelay = clamp(Math.round(Number(merged.min_delay_seconds) || 0), 20, 3600)
  const clean = {
    user_id: userId,
    // Above ~100/day a free Gmail account doing cold outreach gets flagged quickly
    daily_limit: clamp(Math.round(Number(merged.daily_limit) || 0), 1, 400),
    warmup_enabled: Boolean(merged.warmup_enabled),
    warmup_start: clamp(Math.round(Number(merged.warmup_start) || 0), 1, 200),
    warmup_increment: clamp(Math.round(Number(merged.warmup_increment) || 0), 0, 50),
    min_delay_seconds: minDelay,
    max_delay_seconds: clamp(Math.round(Number(merged.max_delay_seconds) || 0), minDelay, 7200),
    send_window_start: clamp(Math.round(Number(merged.send_window_start) || 0), 0, 23),
    send_window_end: clamp(Math.round(Number(merged.send_window_end) || 0), 1, 24),
    skip_weekends: Boolean(merged.skip_weekends),
    timezone: isValidTimezone(String(merged.timezone)) ? String(merged.timezone) : current.timezone,
    max_bounce_rate: clamp(Number(merged.max_bounce_rate) || 0, 0.5, 20),
    use_recipient_timezone: Boolean(merged.use_recipient_timezone),
    updated_at: new Date().toISOString(),
  }

  let { data, error } = await supabaseAdmin
    .from('sender_settings')
    .upsert(clean, { onConflict: 'user_id' })
    .select()
    .single()

  // Column arrives with scripts/11_sequences.sql; keep the other settings saveable before that
  if (error && error.message.includes('use_recipient_timezone')) {
    const { use_recipient_timezone, ...withoutTimezone } = clean
    ;({ data, error } = await supabaseAdmin
      .from('sender_settings')
      .upsert(withoutTimezone, { onConflict: 'user_id' })
      .select()
      .single())
  }

  if (error || !data) throw new Error(error?.message || 'Failed to save settings')
  return { ...data, max_bounce_rate: Number(data.max_bounce_rate) }
}

export interface SendBudget {
  sentLast24h: number
  dailyLimit: number
  remaining: number
  warmupDay: number
}

export async function getSendBudget(userId: string, settings: SenderSettings): Promise<SendBudget> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [initial, followUps, laterSteps, placement, first] = await Promise.all([
    supabaseAdmin
      .from('email_recipients')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .gte('sent_at', since),
    supabaseAdmin
      .from('email_recipients')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .gte('follow_up_sent_at', since),
    // Steps 3+ (step 2 is already counted through follow_up_sent_at)
    supabaseAdmin
      .from('email_recipients')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .gte('current_step', 3)
      .gte('last_step_sent_at', since),
    supabaseAdmin
      .from('placement_tests')
      .select('sent_count')
      .eq('user_id', userId)
      .gte('created_at', since),
    supabaseAdmin
      .from('email_recipients')
      .select('sent_at, campaigns!inner(user_id)')
      .eq('campaigns.user_id', userId)
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: true })
      .limit(1),
  ])

  // laterSteps/placement error out (count null) until 11_sequences.sql is run; they count as 0 then
  const placementSent = (placement.data || []).reduce((sum: number, row: { sent_count: number }) => sum + (row.sent_count || 0), 0)
  const sentLast24h = (initial.count || 0) + (followUps.count || 0) + (laterSteps.count || 0) + placementSent
  const firstSentAt = first.data?.[0]?.sent_at
  const warmupDay = firstSentAt
    ? Math.floor((Date.now() - new Date(firstSentAt).getTime()) / (24 * 60 * 60 * 1000))
    : 0

  const dailyLimit = settings.warmup_enabled
    ? Math.min(settings.daily_limit, settings.warmup_start + settings.warmup_increment * warmupDay)
    : settings.daily_limit

  return { sentLast24h, dailyLimit, remaining: Math.max(0, dailyLimit - sentLast24h), warmupDay }
}

export interface SendWindowStatus {
  open: boolean
  message: string
  localTime: string
}

export function isWithinSendWindow(settings: SenderSettings, now: Date = new Date()): SendWindowStatus {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: settings.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const weekday = parts.find(p => p.type === 'weekday')?.value || ''
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parts.find(p => p.type === 'minute')?.value || '00'
  const localTime = `${weekday} ${String(hour).padStart(2, '0')}:${minute} (${settings.timezone})`

  if (settings.skip_weekends && (weekday === 'Sat' || weekday === 'Sun')) {
    return { open: false, message: `Weekend - sending resumes Monday ${settings.send_window_start}:00`, localTime }
  }
  if (hour < settings.send_window_start || hour >= settings.send_window_end) {
    return {
      open: false,
      message: `Outside sending hours (${settings.send_window_start}:00-${settings.send_window_end}:00 ${settings.timezone})`,
      localTime,
    }
  }
  return { open: true, message: 'Within sending hours', localTime }
}

function randomDelayMs(settings: SenderSettings): number {
  const min = settings.min_delay_seconds
  const max = Math.max(min, settings.max_delay_seconds)
  return Math.round((min + Math.random() * (max - min)) * 1000)
}

/**
 * Atomically reserves the next send slot for this user (shared by all campaigns and
 * by cron + browser callers), so two processes can never send back-to-back.
 */
export async function claimSendSlot(
  userId: string,
  settings: SenderSettings
): Promise<{ ok: boolean; nextSendAt: string }> {
  const now = new Date()
  const nextSendAt = new Date(now.getTime() + randomDelayMs(settings)).toISOString()

  const { data, error } = await supabaseAdmin
    .from('sender_settings')
    .update({ next_send_at: nextSendAt })
    .eq('user_id', userId)
    .or(`next_send_at.is.null,next_send_at.lte.${now.toISOString()}`)
    .select('next_send_at')

  if (error) {
    console.warn('claimSendSlot failed:', error.message)
    return { ok: false, nextSendAt: new Date(now.getTime() + 60_000).toISOString() }
  }
  if (data && data.length > 0) return { ok: true, nextSendAt }

  const { data: current } = await supabaseAdmin
    .from('sender_settings')
    .select('next_send_at')
    .eq('user_id', userId)
    .maybeSingle()

  return { ok: false, nextSendAt: current?.next_send_at || nextSendAt }
}

/** Gives back a claimed slot that wasn't used (e.g. the recipient was skipped). */
export async function releaseSendSlot(userId: string): Promise<void> {
  await supabaseAdmin
    .from('sender_settings')
    .update({ next_send_at: new Date().toISOString() })
    .eq('user_id', userId)
}

const SERVER_FAULT = /\b5\.4\.\d+\b|\b4\.\d\.\d+\b|hop count|mail loop|loop detected|mailbox (is )?full|quota|over ?quota|5\.2\.2|temporar|try again later|timed? ?out/i

/** True for bounces that mean the address is bad (no such user/domain), not a server problem. */
export function isHardBounce(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true
  return !SERVER_FAULT.test(errorMessage)
}

/**
 * Pauses a campaign whose bounce rate is above the user's threshold.
 * High bounce rates are the fastest way to get a Gmail account suspended.
 */
export async function checkBounceGuard(
  campaignId: string,
  settings: SenderSettings
): Promise<{ paused: boolean; rate: number }> {
  const [sent, bounced] = await Promise.all([
    supabaseAdmin
      .from('email_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .not('sent_at', 'is', null),
    supabaseAdmin
      .from('email_recipients')
      .select('error_message')
      .eq('campaign_id', campaignId)
      .eq('status', 'bounced'),
  ])

  const sentCount = sent.count || 0
  // Only "address does not exist" bounces say the list is bad; a recipient server's own
  // fault (mail loop, full mailbox, outage) doesn't, and pausing on it stalls good sends
  const bouncedCount = (bounced.data || []).filter((b) => isHardBounce(b.error_message)).length
  const rate = sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0

  // A single bounce in a small sample is noise, so at least two are needed
  if (sentCount >= 20 && bouncedCount >= 2 && rate > settings.max_bounce_rate) {
    await supabaseAdmin
      .from('campaigns')
      .update({
        status: 'paused',
        paused_reason: `Bounce rate ${rate.toFixed(1)}% is above ${settings.max_bounce_rate}%. Clean the list before resuming.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId)
    return { paused: true, rate }
  }
  return { paused: false, rate }
}
