import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { sendFollowUpEmails, getFollowUpStats } from '@/lib/email/follow-ups'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Cookies can't be set in server actions
            }
          },
        },
      }
    )

    // Verify user owns this campaign
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('user_id')
      .eq('id', campaignId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    const { data: user } = await supabase.auth.getUser()
    if (!user || user.user?.id !== campaign.user_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Send follow-up emails
    const result = await sendFollowUpEmails(campaignId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error sending follow-ups:', error)
    return NextResponse.json(
      { error: 'Failed to send follow-up emails' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Cookies can't be set in server actions
            }
          },
        },
      }
    )

    // Verify user owns this campaign
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('user_id, follow_up_days')
      .eq('id', campaignId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    const { data: user } = await supabase.auth.getUser()
    if (!user || user.user?.id !== campaign.user_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get follow-up statistics
    const stats = await getFollowUpStats(campaignId)

    return NextResponse.json({
      ...stats,
      followUpDays: campaign.follow_up_days,
    })
  } catch (error) {
    console.error('Error getting follow-up stats:', error)
    return NextResponse.json(
      { error: 'Failed to get follow-up statistics' },
      { status: 500 }
    )
  }
}
