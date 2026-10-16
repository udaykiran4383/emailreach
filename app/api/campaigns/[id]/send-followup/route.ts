import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { processSequenceSend } from '@/lib/campaigns/actions'

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

    // Verify ownership
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
        // ?due=1 sends only steps whose delay has passed; otherwise the next step goes out now.
        // Both keep all sending limits; the client calls again at result.nextSendAt
        const onlyDue = new URL(request.url).searchParams.get('due') === '1'
        const result = await processSequenceSend(id, user.id, supabase, { onlyDue })
        return NextResponse.json({ ...result, totalEligible: result.sentCount + result.remaining })
    } catch (error: any) {
        if (error.message === 'No follow-up steps defined') {
            return NextResponse.json({ error: 'Add at least one follow-up step first' }, { status: 400 })
        }
        console.error('Error sending follow-ups:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
