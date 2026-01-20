import { createClient } from '@supabase/supabase-js'
import { sendEmailViaGmail } from '@/lib/email/sender'
import fs from 'fs'
import path from 'path'

// Admin client for background tasks (cron)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function processCampaignSend(
    campaignId: string,
    userId: string, // Needed to fetch Gmail credentials
    sendImmediately: boolean = true,
    supabaseClient?: any // Optional: Pass authenticated client if available (for manual send)
) {
    // Use passed client (manual user action) or admin client (cron)
    const supabase = supabaseClient || supabaseAdmin

    // Get campaign
    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single()

    if (campaignError || !campaign) {
        throw new Error('Campaign not found')
    }

    // Get Gmail credentials
    const { data: gmailCredential, error: gmailError } = await supabase
        .from('gmail_credentials')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (gmailError || !gmailCredential) {
        throw new Error('Gmail account not connected')
    }

    // Get recipients
    const { data: recipients, error: recipientsError } = await supabase
        .from('email_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')

    if (recipientsError) {
        throw new Error(recipientsError.message)
    }

    // For scheduled sends (cron), we might want to check if it's time
    // But this function assumes "do it now". Cron route handles the "time" check.

    if (!recipients || recipients.length === 0) {
        return { success: true, message: 'No recipients to send to', sentCount: 0 }
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

    // Update campaign status
    if (sendImmediately) {
        await supabase
            .from('campaigns')
            .update({
                status: 'sending',
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId)
    }

    let sentCount = 0
    const errors: string[] = []

    for (const recipient of recipients) {
        try {
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
                {
                    subject: campaign.subject_template,
                    body: campaign.email_body_template,
                    attachments: attachments.length > 0 ? attachments : undefined,
                }
            )

            if (result.success) {
                sentCount++
                // Update recipient status
                await supabase
                    .from('email_recipients')
                    .update({
                        status: 'sent',
                        sent_at: new Date().toISOString(),
                        gmail_message_id: result.messageId,
                        gmail_thread_id: result.threadId,
                    })
                    .eq('id', recipient.id)

                // Log the email
                await supabase.from('email_logs').insert({
                    recipient_id: recipient.id,
                    event_type: 'sent',
                    event_timestamp: new Date().toISOString(),
                    metadata: { message_id: result.messageId },
                })
            } else {
                errors.push(`Failed to send to ${recipient.email}: ${result.error}`)
                await supabase
                    .from('email_recipients')
                    .update({
                        status: 'failed',
                        error_message: result.error,
                    })
                    .eq('id', recipient.id)
            }
        } catch (error: any) {
            errors.push(`Error sending to ${recipient.email}: ${error.message}`)
        }

        // Rate limiting - Gmail API allows ~1 email per second for regular accounts
        // Using 2 second delay to be safe and avoid 429 rate limit errors
        await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    // Final campaign status update
    if (sendImmediately) {
        await supabase
            .from('campaigns')
            .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId)
    }

    return {
        success: true,
        sentCount,
        totalRecipients: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
    }
}
