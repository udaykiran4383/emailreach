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
  const { data: recipients, error: recipientsError } = await supabase
    .from('email_recipients')
    .select('*')
    .eq('campaign_id', id)
    .neq('status', 'pending') // Only show processed ones
    .order('updated_at', { ascending: false })

  if (recipientsError) {
    return NextResponse.json({ error: recipientsError.message }, { status: 500 })
  }

  // Calculate metrics
  const totalSent = recipients?.filter((r) => r.status === 'sent' || r.status === 'replied').length || 0
  const totalFailed = recipients?.filter((r) => r.status === 'failed').length || 0
  const totalReplies = recipients?.filter((r) => r.status === 'replied').length || 0

  // Calculate rates
  const openRate = totalSent > 0 ? (totalReplies / totalSent) * 100 : 0
  const failureRate = totalSent + totalFailed > 0 ? (totalFailed / (totalSent + totalFailed)) * 100 : 0

  return NextResponse.json({
    totalSent,
    totalFailed,
    totalReplies,
    openRate: openRate.toFixed(1),
    failureRate: failureRate.toFixed(1),
    logs: recipients?.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      status: r.status === 'replied' ? 'sent' : r.status, // If replied, it was sent. UI handles 'replied' column separately?
      sentAt: r.sent_at || r.updated_at,
      replied: r.status === 'replied',
      replyContent: null, // We don't store reply content in recipients yet
    })),
  })
}
