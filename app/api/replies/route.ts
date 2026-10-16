import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { REPLY_CATEGORIES } from '@/lib/ai/classify-reply'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

/**
 * GET /api/replies?classification=interview_request
 * Replies across all of the user's campaigns, newest first, with counts per classification.
 */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const filter = searchParams.get('classification')

  const { data: campaigns, error: campaignsError } = await supabaseAdmin
    .from('campaigns')
    .select('id, name')
    .eq('user_id', user.id)

  if (campaignsError) {
    return NextResponse.json({ error: campaignsError.message }, { status: 500 })
  }
  if (!campaigns?.length) {
    return NextResponse.json({ replies: [], counts: {}, total: 0 })
  }

  const campaignNames = new Map(campaigns.map(c => [c.id, c.name]))

  const { data: rows, error } = await supabaseAdmin
    .from('email_replies')
    .select('id, campaign_id, recipient_id, gmail_message_id, gmail_thread_id, subject, from_email, body_snippet, received_at, classification, classification_reason, classified_by, return_date, email_recipients(id, name, email, company, status)')
    .in('campaign_id', campaigns.map(c => c.id))
    .order('received_at', { ascending: false })
    .limit(1000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const all = (rows || []).map((r: any) => {
    const recipient = Array.isArray(r.email_recipients) ? r.email_recipients[0] : r.email_recipients
    return {
      id: r.id,
      campaignId: r.campaign_id,
      campaignName: campaignNames.get(r.campaign_id) || '',
      gmailMessageId: r.gmail_message_id,
      threadId: r.gmail_thread_id,
      subject: r.subject || '',
      from: r.from_email || '',
      snippet: r.body_snippet || '',
      receivedAt: r.received_at,
      classification: r.classification || 'unclassified',
      classificationReason: r.classification_reason || '',
      classifiedBy: r.classified_by || null,
      returnDate: r.return_date || null,
      recipient: recipient
        ? { id: recipient.id, name: recipient.name, email: recipient.email, company: recipient.company, status: recipient.status }
        : null,
    }
  })

  const counts: Record<string, number> = {}
  for (const category of REPLY_CATEGORIES) counts[category] = 0
  for (const r of all) counts[r.classification] = (counts[r.classification] || 0) + 1

  const replies = filter ? all.filter(r => r.classification === filter) : all
  return NextResponse.json({ replies, counts, total: all.length })
}
