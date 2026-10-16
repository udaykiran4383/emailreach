import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { getSendBudget, getSenderSettings, isWithinSendWindow } from '@/lib/email/deliverability'

export const dynamic = 'force-dynamic'

// Service role + explicit user_id filters (sender_settings / applications are server-only tables)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const ACTION_CLASSIFICATIONS = ['interview_request', 'referral', 'send_resume', 'interested']
const DAY_MS = 24 * 60 * 60 * 1000

/** Each section degrades to null/empty on its own so a missing migration never blanks the dashboard. */
async function section<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.warn(`[dashboard/summary] ${name} failed:`, err)
    return fallback
  }
}

function dayKey(date: Date, timeZone: string): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = user.id
  const now = Date.now()

  const { data: campaignRows } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, status, paused_reason, auto_follow_up, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  const campaigns = campaignRows || []
  const campaignIds = campaigns.map(c => c.id)
  const campaignNames = new Map(campaigns.map(c => [c.id, c.name]))

  const settings = await section('settings', () => getSenderSettings(userId), null)
  const timeZone = settings?.timezone || 'UTC'

  const today = await section(
    'today',
    async () => {
      if (!settings) return null
      const [budget, window] = [await getSendBudget(userId, settings), isWithinSendWindow(settings)]
      return {
        sent: budget.sentLast24h,
        limit: budget.dailyLimit,
        remaining: budget.remaining,
        warmupDay: budget.warmupDay,
        nextSendAt: settings.next_send_at && new Date(settings.next_send_at).getTime() > now ? settings.next_send_at : null,
        inWindow: window.open,
        windowMessage: window.message,
      }
    },
    null
  )

  // Recipient rows for progress, totals and the 7-day chart (personal scale: a few thousand rows)
  const recipients = await section(
    'recipients',
    async () => {
      if (!campaignIds.length) return []
      const rows: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from('email_recipients')
          .select('id, campaign_id, status, sent_at, opened_at, replied_at, current_step, last_step_sent_at, sequence_stopped')
          .in('campaign_id', campaignIds)
          .range(from, from + 999)
        if (error) {
          // Before 11_sequences.sql the step columns don't exist
          const fallback = await supabaseAdmin
            .from('email_recipients')
            .select('id, campaign_id, status, sent_at, opened_at, replied_at')
            .in('campaign_id', campaignIds)
            .range(from, from + 999)
          if (fallback.error) throw fallback.error
          rows.push(...(fallback.data || []))
          if ((fallback.data || []).length < 1000) break
          continue
        }
        rows.push(...(data || []))
        if ((data || []).length < 1000) break
      }
      return rows
    },
    [] as any[]
  )

  const SENT_STATUSES = new Set(['sent', 'replied', 'bounced'])
  const byCampaign = new Map<string, { total: number; sent: number; pending: number; replied: number }>()
  for (const r of recipients) {
    const entry = byCampaign.get(r.campaign_id) || { total: 0, sent: 0, pending: 0, replied: 0 }
    entry.total++
    if (SENT_STATUSES.has(r.status)) entry.sent++
    if (r.status === 'pending') entry.pending++
    if (r.status === 'replied') entry.replied++
    byCampaign.set(r.campaign_id, entry)
  }

  const activeCampaigns = campaigns
    .filter(c => ['scheduled', 'sending', 'paused'].includes(c.status) || (c.status === 'draft' && (byCampaign.get(c.id)?.total || 0) > 0))
    .slice(0, 6)
    .map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      pausedReason: c.paused_reason || null,
      ...(byCampaign.get(c.id) || { total: 0, sent: 0, pending: 0, replied: 0 }),
    }))

  // Totals over the last 30 days
  const since30 = now - 30 * DAY_MS
  let sent30 = 0
  let opened30 = 0
  let replied30 = 0
  let bounced30 = 0
  for (const r of recipients) {
    if (!r.sent_at || new Date(r.sent_at).getTime() < since30) continue
    sent30++
    if (r.opened_at) opened30++
    if (r.status === 'replied' || r.replied_at) replied30++
    if (r.status === 'bounced') bounced30++
  }

  // Last 7 days, bucketed in the sender's timezone
  const days: { date: string; label: string; sent: number; opened: number; replied: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS)
    days.push({
      date: dayKey(d, timeZone),
      label: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(d),
      sent: 0,
      opened: 0,
      replied: 0,
    })
  }
  const dayIndex = new Map(days.map((d, i) => [d.date, i]))
  const bump = (iso: string | null | undefined, field: 'sent' | 'opened' | 'replied') => {
    if (!iso) return
    const idx = dayIndex.get(dayKey(new Date(iso), timeZone))
    if (idx !== undefined) days[idx][field]++
  }
  for (const r of recipients) {
    bump(r.sent_at, 'sent')
    bump(r.opened_at, 'opened')
    bump(r.replied_at, 'replied')
  }

  const replies = await section(
    'replies',
    async () => {
      if (!campaignIds.length) return []
      const { data, error } = await supabaseAdmin
        .from('email_replies')
        .select('id, campaign_id, gmail_thread_id, subject, from_email, body_snippet, received_at, classification, email_recipients(name, email, company)')
        .in('campaign_id', campaignIds)
        .in('classification', ACTION_CLASSIFICATIONS)
        .order('received_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return (data || []).map((r: any) => {
        const recipient = Array.isArray(r.email_recipients) ? r.email_recipients[0] : r.email_recipients
        return {
          id: r.id,
          campaignName: campaignNames.get(r.campaign_id) || '',
          threadId: r.gmail_thread_id,
          subject: r.subject || '',
          from: recipient?.name || r.from_email || '',
          company: recipient?.company || '',
          snippet: r.body_snippet || '',
          receivedAt: r.received_at,
          classification: r.classification,
        }
      })
    },
    [] as any[]
  )

  const followUpsDue = await section(
    'followUps',
    async () => {
      if (!campaignIds.length) return { next24h: 0, overdue: 0 }
      const { data: steps, error } = await supabaseAdmin
        .from('campaign_steps')
        .select('campaign_id, step_number, delay_days')
        .in('campaign_id', campaignIds)
      if (error) throw error
      const delays = new Map<string, number>()
      for (const s of steps || []) delays.set(`${s.campaign_id}:${s.step_number}`, s.delay_days)

      let next24h = 0
      let overdue = 0
      for (const r of recipients) {
        if (r.status !== 'sent' || r.sequence_stopped) continue
        const nextStep = (r.current_step || 1) + 1
        const delay = delays.get(`${r.campaign_id}:${nextStep}`)
        if (delay === undefined) continue
        const base = r.last_step_sent_at || r.sent_at
        if (!base) continue
        const dueAt = new Date(base).getTime() + delay * DAY_MS
        if (dueAt <= now) overdue++
        else if (dueAt <= now + DAY_MS) next24h++
      }
      return { next24h, overdue }
    },
    null as { next24h: number; overdue: number } | null
  )

  const pipeline = await section(
    'pipeline',
    async () => {
      const { data, error } = await supabaseAdmin
        .from('applications')
        .select('id, company, stage, next_step, next_step_at, job_title')
        .eq('user_id', userId)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const a of data || []) counts[a.stage] = (counts[a.stage] || 0) + 1
      const horizon = now + 2 * DAY_MS
      const nextSteps = (data || [])
        .filter(a => a.next_step_at && new Date(a.next_step_at).getTime() <= horizon && !['offer', 'rejected'].includes(a.stage))
        .sort((a, b) => new Date(a.next_step_at!).getTime() - new Date(b.next_step_at!).getTime())
        .slice(0, 5)
        .map(a => ({
          id: a.id,
          company: a.company,
          jobTitle: a.job_title,
          stage: a.stage,
          nextStep: a.next_step,
          nextStepAt: a.next_step_at,
          overdue: new Date(a.next_step_at!).getTime() < now,
        }))
      return { counts, nextSteps, total: (data || []).length }
    },
    null as { counts: Record<string, number>; nextSteps: any[]; total: number } | null
  )

  return NextResponse.json(
    {
      today,
      totals: {
        campaigns: campaigns.length,
        recipients: recipients.length,
        sent30,
        opened30,
        replied30,
        bounced30,
        replyRate: sent30 > 0 ? Math.round((replied30 / sent30) * 1000) / 10 : null,
        openRate: sent30 > 0 ? Math.round((opened30 / sent30) * 1000) / 10 : null,
      },
      activeCampaigns,
      replies,
      followUpsDue,
      pipeline,
      chart: days,
      timeZone,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
