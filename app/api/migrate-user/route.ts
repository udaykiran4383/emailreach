import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

// ONE-TIME migration endpoint to update 'personal-user' data to the authenticated user's ID
async function runMigration() {
    const user = await getUser()

    if (!user) {
        return NextResponse.json({ error: 'You must be logged in to run this migration' }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()
    const results = {
        campaigns: { before: 0, updated: 0 },
        gmail_credentials: { before: 0, updated: 0 },
    }

    // Count campaigns with 'personal-user'
    const { count: campaignCount } = await supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', 'personal-user')

    results.campaigns.before = campaignCount || 0

    // Update campaigns
    const { error: campaignsError } = await supabase
        .from('campaigns')
        .update({ user_id: user.id })
        .eq('user_id', 'personal-user')

    if (campaignsError) {
        return NextResponse.json({
            error: 'Failed to update campaigns',
            details: campaignsError.message
        }, { status: 500 })
    }

    // Count updated campaigns
    const { count: campaignsUpdated } = await supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

    results.campaigns.updated = campaignsUpdated || 0

    // Count gmail_credentials with 'personal-user'
    const { count: credentialsCount } = await supabase
        .from('gmail_credentials')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', 'personal-user')

    results.gmail_credentials.before = credentialsCount || 0

    // Update gmail_credentials
    const { error: credentialsError } = await supabase
        .from('gmail_credentials')
        .update({ user_id: user.id })
        .eq('user_id', 'personal-user')

    if (credentialsError) {
        console.warn('Warning: Could not update gmail_credentials:', credentialsError.message)
    }

    // Count updated credentials
    const { count: credentialsUpdated } = await supabase
        .from('gmail_credentials')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

    results.gmail_credentials.updated = credentialsUpdated || 0

    return NextResponse.json({
        success: true,
        message: `Migration complete! Updated user_id from 'personal-user' to '${user.id}'`,
        newUserId: user.id,
        results,
    })
}

// Support both GET and POST requests
export async function GET() {
    return runMigration()
}

export async function POST() {
    return runMigration()
}
