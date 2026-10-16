import { google } from 'googleapis'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { scanInboxForBounces } from '@/lib/email/bounces'
import { syncRepliesForUser } from '@/lib/email/reply-sync'

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const supabase = await getSupabaseServerClient()

    // 1. Get Campaign & Verify Ownership
    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // 2. Get Gmail Credentials
    const { data: gmailCredential, error: gmailError } = await supabase
        .from('gmail_credentials')
        .select('*')
        .eq('user_id', user.id)
        .single()

    if (gmailError || !gmailCredential) {
        return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
    }

    // 3. Initialize Gmail Client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
    )
    oauth2Client.setCredentials({
        access_token: gmailCredential.access_token,
        refresh_token: gmailCredential.refresh_token,
        expiry_date: gmailCredential.token_expiry ? new Date(gmailCredential.token_expiry).getTime() : undefined,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    let updatedCount = 0
    let replyCount = 0
    let bounceCount = 0
    let unsubscribeCount = 0
    const logs: string[] = []
    const errors: string[] = []

    // 4. Bounces & unsubscribe requests first, so bounced addresses never count as replies
    const bounceScan = await scanInboxForBounces(gmail, user.id)
    bounceCount = bounceScan.bounced
    unsubscribeCount = bounceScan.unsubscribed
    errors.push(...bounceScan.errors)
    logs.push(`📭 Bounces: ${bounceCount}, unsubscribes: ${unsubscribeCount}`)

    // 5. Replies: one listing of incoming mail, matched against this campaign's recipients
    try {
        const sync = await syncRepliesForUser(gmail, user.id, { campaignIds: [id] })
        updatedCount = sync.updated
        replyCount = sync.replied
        unsubscribeCount += sync.unsubscribed
        errors.push(...sync.errors)
        logs.push(`🔍 Scanned ${sync.scanned} new messages${sync.truncated ? ' (more remain, sync again)' : ''}`)
    } catch (e: any) {
        errors.push(`Reply sync failed: ${e.message}`)
    }

    return NextResponse.json({
        success: true,
        updated: updatedCount,
        replied: replyCount,
        bounced: bounceCount,
        unsubscribed: unsubscribeCount,
        logs: logs,
        errors: errors.length > 0 ? errors : undefined
    })
}
