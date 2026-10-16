import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { NextResponse } from 'next/server'
import { processCampaignSend, processSequenceSend } from '@/lib/campaigns/actions'
import { scanInboxForBounces } from '@/lib/email/bounces'
import { syncRepliesForUser } from '@/lib/email/reply-sync'
import { recordCronHeartbeat } from '@/lib/health'

// Admin client
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

function isAuthorized(request: Request): boolean {
    const secret = process.env.CRON_SECRET
    if (!secret) {
        // Without a secret anyone could trigger sends, so only allow it locally
        return process.env.NODE_ENV !== 'production'
    }
    const authHeader = request.headers.get('authorization')
    const querySecret = new URL(request.url).searchParams.get('secret')
    return authHeader === `Bearer ${secret}` || querySecret === secret
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = {
        bounces_detected: 0,
        unsubscribes_detected: 0,
        replies_synced: 0,
        scheduled_campaigns: 0,
        emails_sent: 0,
        follow_ups: 0,
        errors: [] as string[]
    }

    try {
        const { data: credentials, error: credentialsError } = await supabaseAdmin
            .from('gmail_credentials')
            .select('*')

        if (credentialsError) throw credentialsError

        // One pass per user with Gmail connected
        const seenUsers = new Set<string>()
        for (const credential of credentials || []) {
            const userId = credential.user_id
            if (seenUsers.has(userId)) continue
            seenUsers.add(userId)

            const oauth2Client = new google.auth.OAuth2(
                process.env.GMAIL_CLIENT_ID,
                process.env.GMAIL_CLIENT_SECRET
            )
            oauth2Client.setCredentials({
                access_token: credential.access_token,
                refresh_token: credential.refresh_token,
            })
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

            // 1. Bounces and unsubscribes first, so nothing is sent to a dead address
            try {
                const scan = await scanInboxForBounces(gmail, userId)
                results.bounces_detected += scan.bounced
                results.unsubscribes_detected += scan.unsubscribed
                results.errors.push(...scan.errors.map(e => `Bounce scan ${userId}: ${e}`))
            } catch (e: any) {
                results.errors.push(`Bounce scan ${userId}: ${e.message}`)
            }

            // 2. Replies: one inbox listing for all of the user's campaigns (so follow-ups skip people who answered)
            try {
                const sync = await syncRepliesForUser(gmail, userId, { useWatermark: true })
                results.replies_synced += sync.replied
                results.errors.push(...sync.errors.map(e => `Reply sync ${userId}: ${e}`))
            } catch (e: any) {
                console.error(`Error syncing replies for ${userId}:`, e)
                results.errors.push(`Reply sync ${userId}: ${e.message}`)
            }

            const { data: campaigns, error: campaignsError } = await supabaseAdmin
                .from('campaigns')
                .select('id, user_id, status, auto_follow_up, follow_up_template')
                .eq('user_id', userId)
                .in('status', ['scheduled', 'sending', 'sent'])

            if (campaignsError) {
                results.errors.push(`Campaigns ${userId}: ${campaignsError.message}`)
                continue
            }

            // 3. Continue scheduled campaigns (each call is time-boxed and rate limited)
            for (const campaign of (campaigns || []).filter(c => c.status === 'scheduled')) {
                try {
                    const sendResult = await processCampaignSend(campaign.id, userId, true, supabaseAdmin)
                    results.scheduled_campaigns++
                    results.emails_sent += sendResult.sentCount
                    // Daily limit / sending window apply to the whole account, so stop for this user
                    if (['daily_limit', 'outside_window', 'auth', 'gmail_limit'].includes(sendResult.reason)) break
                } catch (e: any) {
                    console.error(`Error processing scheduled campaign ${campaign.id}:`, e)
                    results.errors.push(`Scheduled Campaign ${campaign.id}: ${e.message}`)
                }
            }

            // 4. Due sequence steps, only for campaigns that opted in
            for (const campaign of (campaigns || []).filter(c => c.auto_follow_up)) {
                try {
                    const followUpResult = await processSequenceSend(campaign.id, userId, supabaseAdmin, { onlyDue: true })
                    results.follow_ups += followUpResult.sentCount
                    // outside_window can be per-campaign when sending in recipients' timezones
                    if (['daily_limit', 'auth', 'gmail_limit'].includes(followUpResult.reason)) break
                } catch (e: any) {
                    if (e.message === 'No follow-up steps defined') continue
                    console.error(`Error sending follow-ups for ${campaign.id}:`, e)
                    results.errors.push(`Follow-up Campaign ${campaign.id}: ${e.message}`)
                }
            }
        }
    } catch (error: any) {
        console.error('Cron job error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await recordCronHeartbeat({ ...results })
    return NextResponse.json(results)
}
