import { createClient } from '@supabase/supabase-js'
import { classifyReply, type ReplyCategory } from '@/lib/ai/classify-reply'
import { blockAddressForUser, isUnsubscribeIntent } from '@/lib/email/bounces'
import { rescheduleFollowUp } from '@/lib/campaigns/actions'
import { advanceStageByEmail } from '@/lib/pipeline'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export interface ReplyRecipient {
  id: string
  campaign_id: string
  email: string
  status?: string | null
  replied_at?: string | null
}

export interface IncomingReply {
  gmailMessageId: string
  threadId?: string | null
  from: string
  subject: string
  snippet: string
  body?: string
  receivedAt: string
}

export interface HandledReply {
  status: 'recorded' | 'duplicate' | 'skipped'
  classification?: ReplyCategory
  /** True when this reply moved the recipient to 'replied' for the first time */
  isNewReply: boolean
  unsubscribed: boolean
}

const AUTO_CATEGORIES: ReplyCategory[] = ['out_of_office', 'auto_reply_other']

function pipelineStageFor(category: ReplyCategory): 'replied' | 'interview' | 'rejected' {
  if (category === 'interview_request') return 'interview'
  if (category === 'rejection' || category === 'not_hiring' || category === 'unsubscribe') return 'rejected'
  return 'replied'
}

/** Day after the out-of-office return date, or a week from now when no date was given. */
export function followUpNotBefore(returnDate: string | null, now: Date = new Date()): Date {
  if (returnDate) {
    const back = new Date(`${returnDate}T09:00:00Z`)
    if (!isNaN(back.getTime()) && back.getTime() > now.getTime()) {
      return new Date(back.getTime() + 24 * 60 * 60 * 1000)
    }
  }
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
}

/**
 * Records one incoming reply from a campaign recipient: classifies it, stores it in
 * email_replies and applies the side effects (status, blocklist, follow-up timing,
 * pipeline stage). Idempotent per Gmail message id.
 */
export async function handleIncomingReply(
  userId: string,
  recipient: ReplyRecipient,
  reply: IncomingReply
): Promise<HandledReply> {
  if (recipient.status === 'bounced') {
    return { status: 'skipped', isNewReply: false, unsubscribed: false }
  }

  const { data: existing } = await supabaseAdmin
    .from('email_replies')
    .select('id, classification')
    .eq('gmail_message_id', reply.gmailMessageId)
    .maybeSingle()

  if (existing?.classification) {
    return { status: 'duplicate', classification: existing.classification, isNewReply: false, unsubscribed: false }
  }

  const text = reply.body || reply.snippet
  const result = await classifyReply(text, reply.subject)
  const category = result.category
  const fromEmail = (reply.from.match(/<([^>]+)>/)?.[1] || reply.from).trim().toLowerCase()

  await supabaseAdmin.from('email_replies').upsert(
    {
      recipient_id: recipient.id,
      campaign_id: recipient.campaign_id,
      gmail_message_id: reply.gmailMessageId,
      gmail_thread_id: reply.threadId || null,
      subject: reply.subject,
      from_email: reply.from,
      body_snippet: reply.snippet,
      full_body: reply.body || null,
      received_at: reply.receivedAt,
      classification: category,
      classification_reason: result.reason,
      classified_by: result.source,
      classified_at: new Date().toISOString(),
      return_date: result.returnDate,
    },
    { onConflict: 'gmail_message_id' }
  )

  // Auto replies: keep the recipient as 'sent' so the follow-up still goes out,
  // but not before the person is back.
  if (AUTO_CATEGORIES.includes(category)) {
    try {
      await rescheduleFollowUp(recipient.id, followUpNotBefore(result.returnDate))
    } catch (err) {
      console.warn('Could not reschedule follow-up:', err instanceof Error ? err.message : err)
    }
    return { status: 'recorded', classification: category, isNewReply: false, unsubscribed: false }
  }

  const isNewReply = recipient.status !== 'replied'
  await supabaseAdmin
    .from('email_recipients')
    .update({
      status: 'replied',
      replied_at: recipient.replied_at || reply.receivedAt,
      reply_snippet: reply.snippet,
      reply_from: reply.from,
      reply_timestamp: reply.receivedAt,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', recipient.id)

  // "Please remove me": never email this address again (keyword check as a safety net
  // in case the classifier picked another category)
  const unsubscribed = category === 'unsubscribe' || isUnsubscribeIntent(`${reply.subject} ${text}`)
  if (unsubscribed) {
    await blockAddressForUser(userId, fromEmail || recipient.email, 'unsubscribed')
  }

  try {
    await advanceStageByEmail(userId, recipient.email, pipelineStageFor(unsubscribed ? 'unsubscribe' : category), result.reason)
  } catch (err) {
    console.warn('Could not update pipeline stage:', err instanceof Error ? err.message : err)
  }

  return { status: 'recorded', classification: category, isNewReply, unsubscribed }
}
