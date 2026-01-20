import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { sendEmailViaGmail } from '@/lib/email/sender'
import fs from 'fs'
import path from 'path'
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

    // 1. Get Campaign
    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (!campaign.follow_up_template) {
        return NextResponse.json({ error: 'No follow-up template defined' }, { status: 400 })
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

    // 3. Get Recipients Eligible for Follow-up
    // Status is sent, no reply, and no follow-up sent yet
    const { data: recipients, error: recipientsError } = await supabase
        .from('email_recipients')
        .select('*')
        .eq('campaign_id', id)
        .eq('status', 'sent')
        .is('replied_at', null)
        .or('follow_up_sent.eq.false,follow_up_sent.is.null')

    if (recipientsError) {
        return NextResponse.json({ error: recipientsError.message }, { status: 500 })
    }

    if (!recipients || recipients.length === 0) {
        return NextResponse.json({ success: true, sentCount: 0, message: 'No eligible recipients for follow-up' })
    }

    // Prepare attachments
    const attachments = []
    if (campaign.resume_storage_path) {
        try {
            const resumePath = campaign.resume_storage_path
            if (fs.existsSync(resumePath)) {
                const fileContent = fs.readFileSync(resumePath)
                attachments.push({
                    filename: path.basename(resumePath),
                    content: fileContent,
                    contentType: 'application/pdf',
                })
            }
        } catch (err) {
            console.error('Error reading resume file:', err)
        }
    }

    let sentCount = 0
    const errors: string[] = []

    // 4. Send Emails
    for (const recipient of recipients) {
        try {
            // Create Threaded Reply
            const originalSubject = campaign.subject_template || ''
            const isReply = !originalSubject.toLowerCase().startsWith('re:')
            const subject = isReply ? `Re: ${originalSubject} ` : originalSubject

            const emailOptions: any = {
                subject: subject,
                body: campaign.follow_up_template,
                // Threading headers
                inReplyTo: recipient.gmail_message_id,
                references: recipient.gmail_message_id,
                threadId: recipient.gmail_thread_id,
                attachments: attachments.length > 0 ? attachments : undefined,
            }

            const result = await sendEmailViaGmail(
                {
                    access_token: gmailCredential.access_token,
                    refresh_token: gmailCredential.refresh_token,
                    expires_at: gmailCredential.expires_at,
                },
                gmailCredential.email_address,
                {
                    email: recipient.email,
                    name: recipient.name,
                    company: recipient.company,
                },
                emailOptions
            )

            if (result.success) {
                sentCount++
                const { error: updateError } = await supabase
                    .from('email_recipients')
                    .update({
                        follow_up_sent: true,
                        follow_up_sent_at: new Date().toISOString(),
                    })
                    .eq('id', recipient.id)

                if (updateError) console.error(`[FollowUp] DB Update Error for ${recipient.email}:`, updateError)

                // Log it
                await supabase.from('email_logs').insert({
                    recipient_id: recipient.id,
                    event_type: 'follow_up_sent',
                    event_timestamp: new Date().toISOString(),
                    metadata: { message_id: result.messageId },
                })
            } else {
                errors.push(`Failed to send to ${recipient.email}: ${result.error} `)
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            errors.push(`Error sending to ${recipient.email}: ${errorMsg} `)
        }
        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return NextResponse.json({
        success: true,
        sentCount,
        totalEligible: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
    })
}
