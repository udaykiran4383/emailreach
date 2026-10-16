import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { processCampaignSend } from '@/lib/campaigns/actions'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { sendImmediately } = await request.json()
  const supabase = await getSupabaseServerClient()

  // Verify ownership
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (sendImmediately) {
    try {
      // Sends a time-boxed slice; the client calls again at result.nextSendAt
      const result = await processCampaignSend(id, user.id, true, supabase)
      return NextResponse.json(result)
    } catch (error: any) {
      console.error('Error in send:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // Cron picks up 'scheduled' campaigns and drips them out within the sending limits
    await supabase
      .from('campaigns')
      .update({
        status: 'scheduled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({
      success: true,
      message: 'Campaign scheduled',
    })
  }
}
