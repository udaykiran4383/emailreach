import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth/actions'
import { NextResponse } from 'next/server'

export async function GET() {
    const user = await getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()

    // We want to aggregate "recent events". 
    // 1. New Campaign Emails (created_at desc)
    // 2. New Replies (replied_at desc)
    // Since we don't have a single "events" table, we'll query both and merge.

    // Fetch recent sent emails (limit 10)
    const { data: sentEmails } = await supabase
        .from('email_recipients')
        .select('id, email, created_at, campaign:campaigns(name)')
        .eq('campaign.user_id', user.id) // Ensure campaign belongs to user
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .limit(10)

    // Fetch recent replies (limit 10)
    const { data: repliedEmails } = await supabase
        .from('email_recipients')
        .select('id, email, replied_at, campaign:campaigns(name)')
        .eq('campaign.user_id', user.id)
        .not('replied_at', 'is', null) // Only where replied_at is NOT null
        .order('replied_at', { ascending: false })
        .limit(10)

    // Fetch recent follow-ups (limit 10)
    const { data: followUps } = await supabase
        .from('email_recipients')
        .select('id, email, follow_up_sent_at, campaign:campaigns(name)')
        .eq('campaign.user_id', user.id)
        .eq('follow_up_sent', true)
        .order('follow_up_sent_at', { ascending: false })
        .limit(10)


    // Normalize and merge
    const events = []

    if (sentEmails) {
        events.push(...sentEmails.map(e => ({
            id: `sent-${e.id}`,
            event_type: 'sent',
            email: e.email,
            // @ts-ignore
            campaign_name: e.campaign?.name || 'Unknown Campaign',
            timestamp: e.created_at
        })))
    }

    if (repliedEmails) {
        events.push(...repliedEmails.map(e => ({
            id: `reply-${e.id}`,
            event_type: 'reply',
            email: e.email,
            // @ts-ignore
            campaign_name: e.campaign?.name || 'Unknown Campaign',
            timestamp: e.replied_at
        })))
    }

    if (followUps) {
        events.push(...followUps.map(e => ({
            id: `follow-${e.id}`,
            event_type: 'follow_up',
            email: e.email,
            // @ts-ignore
            campaign_name: e.campaign?.name || 'Unknown Campaign',
            timestamp: e.follow_up_sent_at
        })))
    }

    // Sort by timestamp desc and take top 10
    // @ts-ignore
    const sortedEvents = events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10)

    return NextResponse.json(sortedEvents)
}
