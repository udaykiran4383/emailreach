import { google } from 'googleapis'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

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

    // 1. Get Campaign & Verify Ownership
    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // 2. Get Gmail Credentials
    const { data: gmailCredential, error: gmailError } = await supabase
        .from('gmail_credentials')
        .select('*')
        .eq('user_id', user.id)
        .single()

    if (gmailError || !gmailCredential) {
        return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
    }

    // 3. Get Recipients (only those with sent emails that have thread IDs)
    const { data: recipients, error: recipientsError } = await supabase
        .from('email_recipients')
        .select('*')
        .eq('campaign_id', id)
        .in('status', ['sent', 'replied']) // Check sent for new replies, replied for backfilling content 
    // Note: run scripts/04_add_reply_content.sql to enable backfilling and content storage

    if (recipientsError) {
        return NextResponse.json({ error: recipientsError.message }, { status: 500 })
    }

    // 4. Initialize Gmail Client
    const oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
    )
    oauth2Client.setCredentials({
        access_token: gmailCredential.access_token,
        refresh_token: gmailCredential.refresh_token,
        expiry_date: gmailCredential.token_expiry ? new Date(gmailCredential.token_expiry).getTime() : undefined,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    let updatedCount = 0
    let replyCount = 0
    let bounceCount = 0
    const logs: string[] = []
    const errors: string[] = []

    // 5. Reverse Sync Strategy (Fast)
    // Instead of checking 1000 recipients 1-by-1, we check "Who emailed me recently?"
    // and match that to our recipient list.

    // A. Map recipients for fast lookup (Email -> Recipient)
    const recipientMap = new Map<string, any>()
    recipients.forEach((r: any) => recipientMap.set(r.email.toLowerCase(), r))

    // B. List recent incoming messages (last 30 days covers typical campaign duration)
    // q: 'to:me newer_than:30d' is good, but doesn't catch bounces sent to "mailer-daemon" effectively
    // Better: 'newer_than:30d' and filter locally.
    // Even better: just check INBOX or All Mail. 'is:unread' is too narrow.
    // Use: 'newer_than:30d' (we will limit validation to our recipient list)
    try {
        const listResp = await gmail.users.messages.list({
            userId: 'me',
            q: 'newer_than:30d',
            maxResults: 500 // Fetch decent chunk. If more needed, we can paginate, but 500 recent emails is a lot for a campaign context
        })

        const messageList = listResp.data.messages || []
        logs.push(`🔍 Found ${messageList.length} recent messages to scan...`)

        // C. Process messages in batches (to avoid rate limits on details fetch)
        const PROCESS_BATCH_SIZE = 20
        for (let i = 0; i < messageList.length; i += PROCESS_BATCH_SIZE) {
            const batch = messageList.slice(i, i + PROCESS_BATCH_SIZE)

            await Promise.all(batch.map(async (msgSummary) => {
                if (!msgSummary.id) return

                try {
                    // Fetch message details (headers & snippet)
                    const msg = await gmail.users.messages.get({
                        userId: 'me',
                        id: msgSummary.id,
                        format: 'full', // Needed for headers and body snippet
                    })

                    // Skip if SENT by us
                    if (msg.data.labelIds?.includes('SENT')) return

                    const headers = msg.data.payload?.headers
                    const fromHeader = headers?.find(h => h.name?.toLowerCase() === 'from')?.value || ''
                    const subjectHeader = headers?.find(h => h.name?.toLowerCase() === 'subject')?.value || ''
                    const snippet = msg.data.snippet || ''
                    const internalDate = msg.data.internalDate

                    // Extract email from "From" header (e.g. "Name <email@domain.com>")
                    const emailMatch = fromHeader.match(/<(.+)>/) || [null, fromHeader]
                    const fromEmail = (emailMatch[1] || fromHeader).trim().toLowerCase()

                    // Check Match
                    let recipient = recipientMap.get(fromEmail)

                    // If not direct match, check if it's a bounce/auto-reply associated with a recipient
                    // Determining WHO the bounce is for is tricky from headers unless we parse body.
                    // But if "from" matches, we are good.

                    // Bounce Detection (Header based)
                    const isBounce = fromHeader.toLowerCase().includes('mailer-daemon') ||
                        fromHeader.toLowerCase().includes('postmaster') ||
                        subjectHeader.toLowerCase().includes('delivery status notification') ||
                        subjectHeader.toLowerCase().includes('failure notice')

                    // Auto-reply Detection
                    const isAutoReply = subjectHeader.toLowerCase().includes('automatic reply') ||
                        subjectHeader.toLowerCase().includes('out of office') ||
                        subjectHeader.toLowerCase().includes('auto-reply')

                    if (recipient) {
                        // Direct match found!
                        const statusToSet = isBounce ? 'bounced' : 'replied'

                        // Only update if status implies we should (or if missing metadata)
                        // If already replied, updating again is fine (updates snippet).
                        // If already bounced, keep bounced.

                        if (recipient.status === 'bounced' && !isBounce) {
                            // Don't overwrite bounce with reply? Or maybe do if they replied after bounce? 
                            // Usually bounce is final.
                        } else {
                            // Insert into email_replies table
                            try {
                                await supabase
                                    .from('email_replies')
                                    .upsert({
                                        recipient_id: recipient.id,
                                        campaign_id: id,
                                        gmail_message_id: msgSummary.id,
                                        gmail_thread_id: msg.data.threadId,
                                        from_email: fromHeader,
                                        body_snippet: snippet,
                                        received_at: internalDate ? new Date(parseInt(internalDate)).toISOString() : new Date().toISOString()
                                    }, { onConflict: 'gmail_message_id' })
                            } catch (e) { console.error("Error upserting email_replies:", e) }

                            // Update recipient
                            const { error } = await supabase
                                .from('email_recipients')
                                .update({
                                    status: statusToSet,
                                    reply_snippet: snippet,
                                    reply_from: fromHeader,
                                    reply_timestamp: internalDate ? new Date(parseInt(internalDate)).toISOString() : new Date().toISOString(),
                                    error_message: isBounce ? 'Bounce detected' : null,
                                    updated_at: new Date().toISOString()
                                })
                                .eq('id', recipient.id)
                        }
                    }

                } catch (e: any) {
                    // Ignore single message errors
                }
            }))
        }

    } catch (listError: any) {
        errors.push(`Failed to list messages: ${listError.message}`)
    }

    return NextResponse.json({
        success: true,
        updated: updatedCount,
        replied: replyCount,
        bounced: bounceCount,
        logs: logs,
        errors: errors.length > 0 ? errors : undefined
    })
}

