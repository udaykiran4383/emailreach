import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = await getSupabaseServerClient()
    const { id } = await params

    try {
        // Update uncertain recipients to pending
        const { data, error, count } = await supabase
            .from('email_recipients')
            .update({
                status: 'pending',
                error_message: null
            })
            .eq('campaign_id', id)
            .eq('status', 'uncertain')
            .select('id')

        if (error) throw error

        // Resume campaign if it was completed
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
        console.error('Error retrying uncertain emails:', error)
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        )
    }
}
