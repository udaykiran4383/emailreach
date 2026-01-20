import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function GET() {
    const { data: campaigns } = await supabaseAdmin.from('campaigns').select('*')
    const { data: recipients } = await supabaseAdmin.from('email_recipients').select('*')
    return NextResponse.json({ campaigns, recipients_count: recipients?.length })
}

export async function POST(request: Request) {
    // Create a test scheduled campaign
    // We need a user ID. We'll pick the first one found in campaigns table, or just use the one from existing data.
    const { data: campaigns } = await supabaseAdmin.from('campaigns').select('user_id').limit(1)

    if (!campaigns || campaigns.length === 0) {
        return NextResponse.json({ error: 'No users found to attach campaign to' })
    }

    const userId = campaigns[0].user_id

    const { data: campaign, error } = await supabaseAdmin.from('campaigns').insert({
        user_id: userId,
        name: 'Automation Test Campaign',
        subject_template: 'Test Automation',
        email_body_template: 'This is a test of the cron system.',
        status: 'scheduled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).select().single()

    if (error) return NextResponse.json({ error: error.message })

    const { error: recipientError } = await supabaseAdmin.from('email_recipients').insert({
        campaign_id: campaign.id,
        email: 'test@example.com', // Dummy email, or safe one? 
        // Ideally we should use a real one if we want to confirm sending, 
        // but for now let's just see if the SYSTEM attempts to process it (status change).
        // If we use a dummy, Gmail might fail, but the STATUS should change to 'failed' or 'sent'.
        // That proves the cron ran.
        name: 'Test User',
        status: 'pending'
    })

    return NextResponse.json({ campaign, recipientError })
}
