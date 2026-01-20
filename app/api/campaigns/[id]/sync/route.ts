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
        .eq('status', 'sent') // Only check sent ones that haven't been marked replied yet

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

    // 5. Check each recipient for replies
    for (const recipient of recipients) {
        try {
            const email = recipient.email.trim()
            const threadId = recipient.gmail_thread_id

            // Method 1: If we have a thread ID, check if there are multiple messages in the thread
            if (threadId) {
                try {
                    const threadResp = await gmail.users.threads.get({
                        userId: 'me',
                        id: threadId,
                        format: 'metadata',
                        metadataHeaders: ['From'],
                    })

                    const messages = threadResp.data.messages || []

                    // Log all "From" headers for debugging
                    const fromHeaders = messages.map(msg => {
                        const fromHeader = msg.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')
                        return fromHeader?.value || '(no from)'
                    })
                    logs.push(`📧 Thread ${threadId} has ${messages.length} msgs. From: ${JSON.stringify(fromHeaders)}`)

                    // Check if any message in the thread is FROM the recipient (not just to them)
                    const emailLower = email.toLowerCase()
                    const hasReply = messages.some(msg => {
                        const fromHeader = msg.payload?.headers?.find(h => h.name?.toLowerCase() === 'from')
                        const fromValue = fromHeader?.value?.toLowerCase() || ''
                        return fromValue.includes(emailLower)
                    })

                    if (hasReply) {
                        const { data: updatedRows, error: updateError } = await supabase
                            .from('email_recipients')
                            .update({
                                status: 'replied',
                                replied_at: new Date().toISOString(),
                            })
                            .eq('id', recipient.id)
                            .select()

                        if (updateError) {
                            logs.push(`❌ DB update failed for ${email}: ${updateError.message}`)
                        } else if (updatedRows && updatedRows.length > 0) {
                            logs.push(`✅ Reply detected from ${email} (via thread ${threadId})`)
                            updatedCount++
                            replyCount++
                        }
                        continue
                    } else {
                        logs.push(`ℹ️ No reply in thread for ${email} (Thread has ${messages.length} message(s))`)
                    }
                } catch (threadError: any) {
                    logs.push(`⚠️ Could not fetch thread ${threadId} for ${email}: ${threadError.message}`)
                }
            }

            // Method 2: Fallback - Search for any email from this address (less accurate)
            // This catches replies even if thread ID wasn't stored
            const query = `from:${email} newer_than:30d`
            const replyResp = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 5,
            })

            if (replyResp.data.messages && replyResp.data.messages.length > 0) {
                // Found potential replies - mark as replied
                const { data: updatedRows, error: updateError } = await supabase
                    .from('email_recipients')
                    .update({
                        status: 'replied',
                        replied_at: new Date().toISOString(),
                    })
                    .eq('id', recipient.id)
                    .select()

                if (updateError) {
                    logs.push(`❌ DB update failed for ${email}: ${updateError.message}`)
                } else if (updatedRows && updatedRows.length > 0) {
                    logs.push(`✅ Reply detected from ${email} (via inbox search)`)
                    updatedCount++
                    replyCount++
                }
                continue
            } else {
                logs.push(`ℹ️ No reply found from ${email}`)
            }

            // Check for Bounces
            const bounceResp = await gmail.users.messages.list({
                userId: 'me',
                q: `from:mailer-daemon "Delivery Status Notification" ${email}`,
                maxResults: 1,
            })

            if (bounceResp.data.messages && bounceResp.data.messages.length > 0) {
                await supabase
                    .from('email_recipients')
                    .update({
                        status: 'failed',
                        error_message: 'Bounced',
                    })
                    .eq('id', recipient.id)

                updatedCount++
                bounceCount++
                logs.push(`❌ Bounce detected for ${email}`)
            }

        } catch (error: any) {
            console.error(`Error checking status for ${recipient.email}:`, error)
            errors.push(`${recipient.email}: ${error.message}`)
            logs.push(`⚠️ Error checking ${recipient.email}: ${error.message}`)
        }
    }

    return NextResponse.json({
        success: true,
        updated: updatedCount,
        replied: replyCount,
        bounced: bounceCount,
        checked: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
        logs: logs
    })
}

