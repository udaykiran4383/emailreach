import { createClient } from '@supabase/supabase-js'
import { sendEmailViaGmail, SendEmailResult } from '@/lib/email/sender'
import { verifyEmailDNS } from '@/lib/email/verifier'
import { downloadResume } from '@/lib/storage/resume'

// Sender email comes from Gmail credentials in database

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

    // Get recipients (limit to MAX_BATCH_SIZE to respect daily limits)
    const MAX_BATCH_SIZE = 500
    const { data: recipients, error: recipientsError } = await supabase
        .from('email_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .limit(MAX_BATCH_SIZE)

    if (recipientsError) {
        throw new Error(recipientsError.message)
    }

    // For scheduled sends (cron), we might want to check if it's time
    // But this function assumes "do it now". Cron route handles the "time" check.

    if (!recipients || recipients.length === 0) {
        // If sendImmediately was requested but no recipients found, maybe they are all sent?
        // Check if there are any pending at all (maybe > 500 limit was hit previously?)
        // If truly 0 pending, ensure campaign is marked 'sent'
        if (sendImmediately) {
            const { count: pendingCount } = await supabase
                .from('email_recipients')
                .select('*', { count: 'exact', head: true })
                .eq('campaign_id', campaignId)
                .eq('status', 'pending')

            if (pendingCount === 0) {
                await supabase
                    .from('campaigns')
                    .update({ status: 'sent', sent_at: new Date().toISOString() })
                    .eq('id', campaignId)
            }
        }
        return { success: true, message: 'No recipients to send to', sentCount: 0 }
    }

    // Prepare attachments
    const attachments = []
    if (campaign.resume_storage_path) {
        try {
            const resume = await downloadResume(campaign.resume_storage_path)
            if (resume) {
                attachments.push({
                    filename: resume.filename,
                    content: resume.content,
                    contentType: 'application/pdf',
                })
            }
        } catch (err) {
            console.error('Error downloading resume:', err)
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
    const rateLimitRetries: { email: string; attempt: number; maxAttempts: number; waitSeconds: number }[] = []

    // Pre-verify emails in parallel batches for speed (MX-only, very fast)
    console.log(`Pre-verifying ${recipients.length} emails in parallel...`)
    const verificationCache = new Map<string, { status: string; reason?: string }>()
    const BATCH_SIZE = 20 // Increased for speed

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE)
        const verificationPromises = batch.map(async (r: { email: string }) => {
            const result = await verifyEmailDNS(r.email)
            return { email: r.email, result }
        })
        const results = await Promise.all(verificationPromises)
        results.forEach(({ email, result }) => {
            verificationCache.set(email, { status: result.status, reason: result.reason })
        })
    }
    console.log(`Pre-verification complete. ${verificationCache.size} emails checked.`)

    for (const recipient of recipients) {
        try {
            // Check pre-verification result - skip invalid emails immediately
            const preVerified = verificationCache.get(recipient.email)
            if (preVerified && preVerified.status === 'invalid') {
                console.warn(`Skipping ${recipient.email}: ${preVerified.reason}`)
                await supabase
                    .from('email_recipients')
                    .update({
                        status: 'skipped',
                        error_message: `Skipped: ${preVerified.reason}`,
                    })
                    .eq('id', recipient.id)
                continue // Skip to next recipient, no delay needed
            }

            // Use sender email from Gmail credentials
            const senderEmail = gmailCredential.email_address

            const result = await sendEmailViaGmail(
                {
                    access_token: gmailCredential.access_token,
                    refresh_token: gmailCredential.refresh_token,
                    expires_at: gmailCredential.expires_at,
                },
                senderEmail,
                {
                    email: recipient.email,
                    name: recipient.name,
                    company: recipient.company,
                },
                {
                    subject: campaign.subject_template,
                    body: campaign.email_body_template,
                    attachments: attachments.length > 0 ? attachments : undefined,
                },
                preVerified?.status === 'safe' // skipVerification if already pre-verified as safe
            )

            // Track rate limit retries
            if (result.rateLimitInfo) {
                rateLimitRetries.push({ email: recipient.email, ...result.rateLimitInfo })
            }

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
                // If it's a blocking error (Daily Limit), stop immediately
                if (result.isBlocking) {
                    console.warn(`Blocking error encountered for ${recipient.email}. Pausing campaign.`)
                    // DO NOT mark as failed. Leave as pending.
                    // Break the loop

                    // Update campaign status to paused
                    await supabase
                        .from('campaigns')
                        .update({
                            status: 'paused',
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', campaignId)

                    return {
                        success: false,
                        sentCount,
                        totalRecipients: recipients.length,
                        errors: [...errors, 'Campaign paused due to Gmail Daily Limit'],
                        stopped: true
                    }
                }

                errors.push(`Failed to send to ${recipient.email}: ${result.error}`)

                // Auto-block emails that appear to be invalid/bounced
                const errorLower = (result.error || '').toLowerCase()
                const shouldBlock = errorLower.includes('bounced') ||
                    errorLower.includes('blocked') ||
                    errorLower.includes('address') ||
                    errorLower.includes('not found') ||
                    errorLower.includes('invalid')

                if (shouldBlock) {
                    await supabase.from('blocked_emails').upsert({
                        email: recipient.email.toLowerCase(),
                        reason: 'bounced',
                        source_campaign_id: campaignId,
                        blocked_at: new Date().toISOString()
                    }, { onConflict: 'email' }).catch(() => { })
                }

                if (result.error === 'SMTP_VERIFICATION_TIMEOUT') {
                    await supabase
                        .from('email_recipients')
                        .update({
                            status: 'uncertain',
                            error_message: 'SMTP Verification incomplete (Timeout)',
                        })
                        .eq('id', recipient.id)
                } else {
                    await supabase
                        .from('email_recipients')
                        .update({
                            status: 'failed',
                            error_message: result.error,
                        })
                        .eq('id', recipient.id)
                }
            }
        } catch (error: any) {
            // Handle Limit Reached thrown directly (backup check)
            if (error.message?.includes('GMAIL_DAILY_LIMIT_REACHED')) {
                await supabase
                    .from('campaigns')
                    .update({ status: 'paused' })
                    .eq('id', campaignId)
                return { success: false, sentCount, errors: ['Daily Limit Reached'], stopped: true }
            }

            // Handle Gmail token expired - stop immediately
            if (error.message?.includes('invalid_grant') || error.message?.includes('Gmail token')) {
                await supabase
                    .from('campaigns')
                    .update({ status: 'paused' })
                    .eq('id', campaignId)
                return {
                    success: false,
                    sentCount,
                    errors: ['Gmail token expired. Please reconnect Gmail in Settings.'],
                    stopped: true,
                    authError: true
                }
            }

            errors.push(`Error sending to ${recipient.email}: ${error.message}`)
            // Update status to failed so it shows up in analytics
            await supabase
                .from('email_recipients')
                .update({
                    status: 'failed',
                    error_message: error.message,
                })
                .eq('id', recipient.id)
        }

        // Rate limiting - Gmail allows ~100 emails/min, 1s delay = ~60/min (safe margin)
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Final campaign status update
    if (sendImmediately) {
        // Check if there are any remaining pending recipients
        const { count: remainingPending } = await supabase
            .from('email_recipients')
            .select('*', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('status', 'pending')

        const newStatus = remainingPending && remainingPending > 0 ? 'scheduled' : 'sent'

        await supabase
            .from('campaigns')
            .update({
                status: newStatus,
                sent_at: newStatus === 'sent' ? new Date().toISOString() : undefined,
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId)
    }

    return {
        success: true,
        sentCount,
        totalRecipients: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
        rateLimitRetries: rateLimitRetries.length > 0 ? rateLimitRetries : undefined,
    }
}
