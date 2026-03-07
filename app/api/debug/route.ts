import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

export async function GET() {
    const supabase = await getSupabaseServerClient()
    const user = await getUser()

    // Get unique user_ids from campaigns
    const { data: campaigns, error: campaignsError } = await supabase
        .from('campaigns')
        .select('id, name, user_id')
        .limit(20)

    // Get all recipients
    const { data: recipients, error: recipientsError } = await supabase
        .from('email_recipients')
        .select('id, email, name, status, gmail_thread_id, gmail_message_id, replied_at')
        .limit(20)

    const response = {
        authenticatedUser: {
            id: user?.id || 'NOT LOGGED IN',
            email: user?.email || 'N/A',
        },
        campaigns: {
            error: campaignsError?.message,
            count: campaigns?.length || 0,
            uniqueUserIds: [...new Set(campaigns?.map(c => c.user_id) || [])],
            items: campaigns?.slice(0, 5).map(c => ({
                id: c.id,
                name: c.name,
                user_id: c.user_id,
                matchesCurrentUser: c.user_id === user?.id,
            })) || [],
        },
        recipients: {
            error: recipientsError?.message,
            count: recipients?.length || 0,
            statusCounts: {
                pending: recipients?.filter(r => r.status === 'pending').length || 0,
                sent: recipients?.filter(r => r.status === 'sent').length || 0,
                replied: recipients?.filter(r => r.status === 'replied').length || 0,
                failed: recipients?.filter(r => r.status === 'failed').length || 0,
            },
        },
        diagnosis: '',
    }

    // Provide diagnosis
    if (!user) {
        response.diagnosis = 'You are not logged in. Please log in first.'
    } else if (campaigns && campaigns.length > 0 && !campaigns.some(c => c.user_id === user.id)) {
        response.diagnosis = `USER ID MISMATCH: Your current user_id is "${user.id}", but your campaigns have different user_ids: [${response.campaigns.uniqueUserIds.join(', ')}]. You need to update the user_id in Supabase.`
    } else if (!campaigns || campaigns.length === 0) {
        response.diagnosis = 'No campaigns found in database.'
    } else {
        response.diagnosis = 'User ID matches. Data should be visible.'
    }

    return NextResponse.json(response)
}
