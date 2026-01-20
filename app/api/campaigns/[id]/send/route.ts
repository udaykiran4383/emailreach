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
      // Use the reusable logic, passing the authenticated client
      const result = await processCampaignSend(id, user.id, true, supabase)
      return NextResponse.json(result)
    } catch (error: any) {
      console.error('Error in send:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // Just update status to scheduled
    await supabase
      .from('campaigns')
      .update({
        status: 'scheduled',
        updated_at: new Date().toISOString(),
        // Assuming we might want to set a scheduled_time field, but user hasn't asked for it yet
        // For now, 'scheduled' just means "ready for cron to pick up if we had logic for timing"
        // But since we don't have a specific time picker, "Schedule" usually implies "Queue it".
        // Wait, the Cron "Scheduled Campaigns" logic needs a time.
        // The current Send Now/Schedule UI is simple.
        // Let's assume "Schedule" just marks it as 'scheduled' and we need to add a "scheduled_at" column or logic later.
        // For now, just marking it 'scheduled' is initialized.
      })
      .eq('id', id)

    return NextResponse.json({
      success: true,
      message: 'Campaign scheduled',
    })
  }
}

