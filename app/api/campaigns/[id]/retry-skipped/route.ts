import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()
    const { id } = await params

    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    try {
        // Update skipped recipients to pending.
        // Never resurrect 'Blocked:' rows: those addresses bounced or asked to be removed.
        const { data, error, count } = await supabase
            .from('email_recipients')
            .update({
                status: 'pending',
                error_message: null, // Clear error message
                // Force a fresh verification on the next send
                verification_status: null,
                verification_reason: null,
                verified_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('campaign_id', id)
            .eq('status', 'skipped')
            .or('error_message.is.null,error_message.not.ilike.Blocked*')
            .select('id')

        if (error) throw error

        // Also resume campaign if it was completed
        await supabase
            .from('campaigns')
            .update({ status: 'scheduled' })
            .eq('id', id)
            .eq('status', 'sent')

        return NextResponse.json({
            success: true,
            count: count || data?.length || 0
        })
    } catch (error: any) {
        console.error('Error retrying skipped emails:', error)
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }
}
