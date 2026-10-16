import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { verifyEmailsBatch } from '@/lib/email/verifier'

// Stay well inside short serverless timeouts; the client calls again until remaining = 0
const TIME_BUDGET_MS = 8000
const CHUNK_SIZE = 25

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

    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const deadline = Date.now() + TIME_BUDGET_MS
    let verified = 0
    let invalid = 0
    let risky = 0

    while (Date.now() < deadline) {
        const { data: batch, error } = await supabase
            .from('email_recipients')
            .select('id, email')
            .eq('campaign_id', id)
            .eq('status', 'pending')
            .is('verified_at', null)
            .limit(CHUNK_SIZE)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }
        if (!batch || batch.length === 0) break

        const results = await verifyEmailsBatch(batch.map(r => r.email))
        const now = new Date().toISOString()

        for (const r of batch) {
            const result = results.get(r.email) || { status: 'risky' as const, reason: 'Not verified' }
            const update: Record<string, any> = {
                verification_status: result.status,
                verification_reason: result.reason || null,
                verified_at: now,
                updated_at: now,
            }
            if (result.status === 'invalid') {
                update.status = 'skipped'
                update.error_message = `Skipped: ${result.reason || 'Invalid email'}`
                invalid++
            } else if (result.status === 'risky') {
                risky++
            }
            await supabase.from('email_recipients').update(update).eq('id', r.id)
            verified++
        }
    }

    const { count: remaining } = await supabase
        .from('email_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id)
        .eq('status', 'pending')
        .is('verified_at', null)

    return NextResponse.json({ verified, invalid, risky, remaining: remaining || 0 })
}
