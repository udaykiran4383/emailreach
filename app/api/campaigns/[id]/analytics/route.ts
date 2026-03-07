import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth/actions'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = await getSupabaseServerClient()

  // Verify campaign belongs to user
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Get email recipients for this campaign
  // Get email recipients for this campaign
  // Try fetching with replies first (assuming migration ran)
  let { data: recipients, error: recipientsError } = await supabase
    .from('email_recipients')
    .select('*, email_replies(*)') // Fetch related replies
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })

  if (recipientsError) {
    // Fallback: If table missing, fetch just recipients
    // console.warn('Deep fetch failed (likely missing migration), falling back:', recipientsError.message)
    const { data: recipientsFallback, error: fallbackError } = await supabase
      .from('email_recipients')
      .select('*')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false })

    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 })
    }
    recipients = recipientsFallback
  }

  // Calculate metrics
  const allRecipients = recipients || []

  // Skipped emails (blocked/invalid validation)
  const skippedRecipients = allRecipients.filter(r =>
    r.error_message?.startsWith('Skipped') ||
    r.error_message?.startsWith('Blocked') ||
    r.status === 'skipped'
  )
  const totalSkipped = skippedRecipients.length

  // Active recipients (not skipped)
  const activeRecipients = allRecipients.filter(r =>
    !r.error_message?.startsWith('Skipped') &&
    !r.error_message?.startsWith('Blocked') &&
    r.status !== 'skipped'
  )

  const totalSent = activeRecipients.filter((r) => r.status === 'sent' || r.status === 'replied').length
  const totalFailed = activeRecipients.filter((r) => r.status === 'failed').length
  const totalReplies = activeRecipients.filter((r) => r.status === 'replied').length
  const totalPending = activeRecipients.filter((r) => r.status === 'pending').length
  const totalUncertain = activeRecipients.filter((r) => r.status === 'uncertain').length

  // Calculate rates
  const openRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0
  const failureRate = totalSent + totalFailed > 0 ? (totalFailed / (totalSent + totalFailed)) * 100 : 0

  return NextResponse.json({
    totalSent,
    totalFailed,
    totalReplies,
    totalPending,
    totalSkipped,
    totalUncertain,
    openRate: openRate.toFixed(1),
    failureRate: failureRate.toFixed(1),
    logs: activeRecipients.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      status: r.status === 'replied' ? 'sent' : r.status,
      sentAt: r.sent_at || r.created_at,
      replied: r.status === 'replied',
      replyContent: r.reply_snippet || null,
      replyFrom: r.reply_from || null,
      replyTimestamp: r.reply_timestamp || null,
      // @ts-ignore
      replies: r.email_replies || []
    })),
    skippedLogs: skippedRecipients.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      reason: r.error_message || 'Skipped',
    })),
  })
}

