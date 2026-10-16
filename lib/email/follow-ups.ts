import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { processFollowUpSend } from '@/lib/campaigns/actions'

// Admin client for background tasks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

/**
 * Sends due follow-ups for a campaign (throttled, same limits as first emails).
 * Kept for existing callers; the real work lives in processFollowUpSend.
 */
export async function sendFollowUpEmails(campaignId: string, client?: any) {
  const supabase = client || supabaseAdmin

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('user_id')
    .eq('id', campaignId)
    .single()

  if (campaignError || !campaign) {
    throw new Error('Campaign not found')
  }

  const result = await processFollowUpSend(campaignId, campaign.user_id, supabase, { onlyDue: true })

  return {
    ...result,
    totalEligible: result.sentCount + result.remaining,
  }
}

export async function getFollowUpStats(campaignId: string) {
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

  const { data, error } = await supabase
    .from('email_recipients')
    .select('follow_up_sent, status')
    .eq('campaign_id', campaignId)

  if (error) {
    throw error
  }

  return {
    totalFollowUpsSent: data?.filter((r) => r.follow_up_sent).length || 0,
    totalReplies: data?.filter((r) => r.status === 'replied').length || 0,
    totalFollowUpReplies: data?.filter(
      (r) => r.follow_up_sent && r.status === 'replied'
    ).length || 0,
  }
}
