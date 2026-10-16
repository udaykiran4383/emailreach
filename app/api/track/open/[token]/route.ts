import { createClient } from '@supabase/supabase-js'
import { verifyTrackingToken, TRANSPARENT_GIF } from '@/lib/email/tracking'
import { incrementOpen } from '@/lib/db/atomic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Opens this soon after sending are the sender's own client rendering the message
const SELF_OPEN_WINDOW_MS = 10_000

function pixel() {
    return new Response(new Uint8Array(TRANSPARENT_GIF), {
        status: 200,
        headers: {
            'Content-Type': 'image/gif',
            'Content-Length': String(TRANSPARENT_GIF.length),
            'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
            Pragma: 'no-cache',
            Expires: '0',
        },
    })
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await params
        const recipientId = verifyTrackingToken(token)
        if (!recipientId) return pixel()

        const { data: recipient } = await supabaseAdmin
            .from('email_recipients')
            .select('id, sent_at')
            .eq('id', recipientId)
            .single()

        if (!recipient) return pixel()
        if (recipient.sent_at && Date.now() - new Date(recipient.sent_at).getTime() < SELF_OPEN_WINDOW_MS) {
            return pixel()
        }

        const now = new Date().toISOString()
        const ua = request.headers.get('user-agent') || ''

        await incrementOpen(recipient.id, now)

        await supabaseAdmin.from('email_logs').insert({
            recipient_id: recipient.id,
            event_type: 'opened',
            event_timestamp: now,
            metadata: { ua: ua.slice(0, 300), proxy: /GoogleImageProxy|YahooMailProxy/i.test(ua) },
        })
    } catch (error) {
        console.error('Open tracking error:', error)
    }
    return pixel()
}
