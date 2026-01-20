import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
    const supabase = await getSupabaseServerClient()

    // Get all recipients
    const { data: recipients, error } = await supabase
        .from('email_recipients')
        .select('id, email, name, status, gmail_thread_id, gmail_message_id, replied_at')
        .limit(20)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const summary = {
        total: recipients.length,
        withThreadId: recipients.filter(r => r.gmail_thread_id).length,
        statusCounts: {
            pending: recipients.filter(r => r.status === 'pending').length,
            sent: recipients.filter(r => r.status === 'sent').length,
            replied: recipients.filter(r => r.status === 'replied').length,
            failed: recipients.filter(r => r.status === 'failed').length,
        },
        recipients: recipients.map(r => ({
            email: r.email,
            name: r.name,
            status: r.status,
            hasThreadId: !!r.gmail_thread_id,
            threadId: r.gmail_thread_id,
            repliedAt: r.replied_at,
        }))
    }

    return NextResponse.json(summary)
}
