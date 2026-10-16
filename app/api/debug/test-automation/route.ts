import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { guardDebugRoute } from '@/lib/debug-guard'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Dev-only helpers for testing the cron pipeline. Scoped to the signed-in user:
// the service-role client bypasses RLS, so every query filters by user_id.

export async function GET() {
    const guard = await guardDebugRoute()
    if (!guard.ok) return guard.response

    const { data: campaigns } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .eq('user_id', guard.user.id)
    const campaignIds = (campaigns || []).map((c) => c.id)
    const { count } = campaignIds.length
        ? await supabaseAdmin
            .from('email_recipients')
            .select('*', { count: 'exact', head: true })
            .in('campaign_id', campaignIds)
        : { count: 0 }
    return NextResponse.json({ campaigns, recipients_count: count || 0 })
}

export async function POST() {
    const guard = await guardDebugRoute()
    if (!guard.ok) return guard.response

    // Create a test scheduled campaign for the signed-in user
    const { data: campaign, error } = await supabaseAdmin.from('campaigns').insert({
        user_id: guard.user.id,
        name: 'Automation Test Campaign',
        subject_template: 'Test Automation',
        email_body_template: 'This is a test of the cron system.',
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).select().single()

    if (error) return NextResponse.json({ error: error.message })

    // example.com never receives mail: verification skips it, which still proves the cron ran
    const { error: recipientError } = await supabaseAdmin.from('email_recipients').insert({
        campaign_id: campaign.id,
        email: 'test@example.com',
        name: 'Test User',
        status: 'pending'
    })

    return NextResponse.json({ campaign, recipientError })
}
