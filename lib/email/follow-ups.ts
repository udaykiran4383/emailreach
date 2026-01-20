import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

// Admin client for background tasks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function sendFollowUpEmails(campaignId: string, client?: any) {
  let supabase = client

  if (!supabase) {
    // If no client provided, try to use cookies (user action)
    // If cookies fail (e.g. cron without client), use admin
    try {
      const cookieStore = await cookies()
      supabase = createServerClient(
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
    } catch (e) {
      // Fallback to admin if cookies() is not available (e.g. background task)
      supabase = supabaseAdmin
    }
  }

  // Get campaign details
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single()

  if (campaignError || !campaign) {
    throw new Error('Campaign not found')
  }

  // Get recipients who haven't replied and are eligible for follow-up
  // Constraint removed: Send immediately if eligible
  // const followUpDate = new Date()
  // followUpDate.setDate(followUpDate.getDate() - campaign.follow_up_days)

  const { data: recipients, error: recipientsError } = await supabase
    .from('email_recipients')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .eq('follow_up_sent', false)
  // .lt('sent_at', followUpDate.toISOString())

  if (recipientsError) {
    throw new Error(`Failed to fetch recipients: ${recipientsError.message}`)
  }

  // Send follow-up emails
  let sentCount = 0

  for (const recipient of recipients || []) {
    try {
      // Personalize follow-up email
      const variables = {
        name: recipient.name,
        company: recipient.company,
        role: recipient.role,
        ...recipient.variables,
      }

      let followUpBody = campaign.follow_up_template || ''
      Object.keys(variables).forEach((key) => {
        followUpBody = followUpBody.replace(
          new RegExp(`{{${key}}}`, 'g'),
          variables[key as keyof typeof variables] || ''
        )
      })

      // Update recipient with follow-up sent status
      await supabase
        .from('email_recipients')
        .update({
          follow_up_sent: true,
          follow_up_sent_at: new Date().toISOString(),
        })
        .eq('id', recipient.id)

      // Log the follow-up event
      await supabase.from('email_logs').insert({
        recipient_id: recipient.id,
        event_type: 'follow_up_sent',
        metadata: {
          body_snippet: followUpBody.substring(0, 100),
        },
      })

      sentCount++
    } catch (error) {
      console.error(`Failed to send follow-up to ${recipient.email}:`, error)
    }
  }

  return {
    sentCount,
    totalEligible: recipients?.length || 0,
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
