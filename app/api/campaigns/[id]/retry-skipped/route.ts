import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const supabase = await getSupabaseServerClient()
    const { id } = params

    try {
        // Update skipped recipients to pending
        const { data, error, count } = await supabase
            .from('email_recipients')
            .update({
                status: 'pending',
                error_message: null, // Clear error message
                updated_at: new Date().toISOString()
            })
            .eq('campaign_id', id)
            .eq('status', 'skipped')
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
