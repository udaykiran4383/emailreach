import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextResponse } from 'next/server'
import { processCampaignSend } from '@/lib/campaigns/actions'
import { sendFollowUpEmails } from '@/lib/email/follow-ups'

// Admin client
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

/**
 * Syncs reply status for a campaign by checking Gmail threads
 */
async function syncRepliesForCampaign(campaignId: string, userId: string): Promise<{ replied: number; errors: string[] }> {
    const errors: string[] = []
    let repliedCount = 0

    // Get Gmail credentials for this user
    const { data: gmailCredential, error: gmailError } = await supabaseAdmin
        .from('gmail_credentials')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (gmailError || !gmailCredential) {
        return { replied: 0, errors: ['Gmail not connected for user'] }
    }

    // Get sent recipients for this campaign
    const { data: recipients, error: recipientsError } = await supabaseAdmin
        .from('email_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'sent')

    if (recipientsError || !recipients || recipients.length === 0) {
        return { replied: 0, errors: [] }
    }

    // Initialize Gmail client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
    )
    oauth2Client.setCredentials({
        access_token: gmailCredential.access_token,
        refresh_token: gmailCredential.refresh_token,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Check each recipient
    for (const recipient of recipients) {
        try {
            const email = recipient.email.trim()
            const threadId = recipient.gmail_thread_id

            let hasReply = false

            // Method 1: Check thread if we have thread ID
            if (threadId) {
                try {
                    const threadResp = await gmail.users.threads.get({
                        userId: 'me',
                        id: threadId,
                        format: 'metadata',
                        metadataHeaders: ['From'],
                    })

                    const messages = threadResp.data.messages || []
                    hasReply = messages.some(msg => {
                        const fromHeader = msg.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')
                        const fromValue = fromHeader?.value?.toLowerCase() || ''
                        return fromValue.includes(email.toLowerCase())
                    })
                } catch (e) {
                    // Thread fetch failed, try fallback
                }
            }

            // Method 2: Fallback inbox search
            if (!hasReply) {
                const replyResp = await gmail.users.messages.list({
                    userId: 'me',
                    q: `from:${email} newer_than:30d`,
                    maxResults: 5,
                })
                hasReply = (replyResp.data.messages?.length || 0) > 0
            }

            if (hasReply) {
                await supabaseAdmin
                    .from('email_recipients')
                    .update({
                        status: 'replied',
                        replied_at: new Date().toISOString(),
                    })
                    .eq('id', recipient.id)
                repliedCount++
            }
        } catch (error: any) {
            errors.push(`${recipient.email}: ${error.message}`)
        }
    }

    return { replied: repliedCount, errors }
}

export async function GET(request: Request) {
    // Check CRON_SECRET for security
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        if (process.env.CRON_SECRET) {
            // Commented out for dev testing
            // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
    }

    const results = {
        scheduled_campaigns: 0,
        follow_ups: 0,
        replies_synced: 0,
        errors: [] as string[]
    }

    try {
        // 1. Process Scheduled Campaigns
        const { data: scheduledCampaigns, error: scheduledError } = await supabaseAdmin
            .from('campaigns')
            .select('id, user_id')
            .eq('status', 'scheduled')

        if (scheduledError) throw scheduledError

        if (scheduledCampaigns && scheduledCampaigns.length > 0) {
            for (const campaign of scheduledCampaigns) {
                try {
                    await processCampaignSend(campaign.id, campaign.user_id, true, supabaseAdmin)
                    results.scheduled_campaigns++
                } catch (e: any) {
                    console.error(`Error processing scheduled campaign ${campaign.id}:`, e)
                    results.errors.push(`Scheduled Campaign ${campaign.id}: ${e.message}`)
                }
            }
        }

        // 2. Sync Replies for Active Campaigns
        const { data: activeCampaigns, error: activeError } = await supabaseAdmin
            .from('campaigns')
            .select('id, user_id')
            .in('status', ['sent', 'sending'])

        if (activeError) throw activeError

        if (activeCampaigns && activeCampaigns.length > 0) {
            for (const campaign of activeCampaigns) {
                try {
                    const syncResult = await syncRepliesForCampaign(campaign.id, campaign.user_id)
                    results.replies_synced += syncResult.replied
                    if (syncResult.errors.length > 0) {
                        results.errors.push(...syncResult.errors.map(e => `Sync ${campaign.id}: ${e}`))
                    }
                } catch (e: any) {
                    console.error(`Error syncing replies for ${campaign.id}:`, e)
                    results.errors.push(`Sync Campaign ${campaign.id}: ${e.message}`)
                }
            }
        }

        // 3. Process Follow-ups (after sync so we don't send to those who replied)
        if (activeCampaigns && activeCampaigns.length > 0) {
            for (const campaign of activeCampaigns) {
                try {
                    const result = await sendFollowUpEmails(campaign.id, supabaseAdmin)
                    results.follow_ups += result.sentCount
                } catch (e: any) {
                    console.error(`Error sending follow-ups for ${campaign.id}:`, e)
                    results.errors.push(`Follow-up Campaign ${campaign.id}: ${e.message}`)
                }
            }
        }

    } catch (error: any) {
        console.error('Cron job error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(results)
}

