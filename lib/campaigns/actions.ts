import { createClient } from '@supabase/supabase-js'
import { sendEmailViaGmail, SendEmailResult } from '@/lib/email/sender'
import { verifyEmail } from '@/lib/email/verifier'
import { downloadResume } from '@/lib/storage/resume'
import { createOpenTrackingUrl } from '@/lib/email/tracking'
import { pickInWindow, recipientTimezone } from '@/lib/email/timezones'
import { advanceStageByEmail } from '@/lib/pipeline'
import { getResumeUrlForRecipient } from '@/lib/resume-links'
import {
    SequenceStep,
    checkStepEligibility,
    companyDomainOf,
    stepSubject,
} from '@/lib/campaigns/sequence-logic'
import {
    getSenderSettings,
    getSendBudget,
    isWithinSendWindow,
    claimSendSlot,
    releaseSendSlot,
    checkBounceGuard,
    SenderSettings,
} from '@/lib/email/deliverability'

// Sender email comes from Gmail credentials in database

// Admin client for background tasks (cron)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Each call sends for at most this long, then returns. The browser or cron calls again
// at nextSendAt, so requests never outlive serverless timeouts.
const MAX_RUN_MS = (parseInt(process.env.SEND_MAX_RUN_SECONDS || '8', 10) || 8) * 1000
const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Recipient-timezone picking pages through pending recipients in chunks
const TIMEZONE_PICK_BATCH = 100
const TIMEZONE_PICK_MAX_CHUNKS = 5
// Sequence eligibility: SQL pre-filters, JS applies the per-step rules page by page
const SEQUENCE_PAGE_SIZE = 100
const SEQUENCE_MAX_SCAN = 5000

export type DripReason =
    | 'done'
    | 'waiting'
    | 'daily_limit'
    | 'outside_window'
    | 'bounce_rate'
    | 'auth'
    | 'gmail_limit'

export interface DripResult {
    success: boolean
    sentCount: number
    skippedCount: number
    remaining: number
    nextSendAt: string | null
    reason: DripReason
    sentToday: number
    dailyLimit: number
    message: string
    errors?: string[]
    stopped?: boolean
    authError?: boolean
    // Kept for the existing UI
    totalRecipients?: number
}

interface Attachment {
    filename: string
    content: Buffer
    contentType: string
}

/** fetchNext result when recipients remain but none is inside their local sending hours */
const NONE_IN_WINDOW = Symbol('none-in-window')

interface DripOptions {
    supabase: any
    campaign: any
    userId: string
    gmailCredential: any
    settings: SenderSettings
    /** Next recipient to email, excluding ids already attempted in this run */
    fetchNext: (excludeIds: string[]) => Promise<any | null | typeof NONE_IN_WINDOW>
    /** Verifies the recipient; skip releases the claimed send slot */
    prepare?: (recipient: any) => Promise<{ skip: true; reason: string } | { skip: false }>
    buildEmail: (recipient: any, attachments: Attachment[]) => {
        subject: string
        body: string
        inReplyTo?: string
        references?: string
        threadId?: string
        attachments?: Attachment[]
        trackingPixelUrl?: string
    }
    onSent: (recipient: any, result: SendEmailResult) => Promise<void>
    onFailed: (recipient: any, result: SendEmailResult) => Promise<void>
    countRemaining: () => Promise<number>
}

/**
 * Shared drip loop for first emails and follow-ups: bounce guard -> sending window ->
 * daily budget -> send slot -> one email. Stops when the time budget runs out.
 */
async function runDrip(opts: DripOptions): Promise<DripResult> {
    const { campaign, userId, gmailCredential, settings } = opts
    const deadline = Date.now() + MAX_RUN_MS
    const attempted: string[] = []
    const errors: string[] = []
    let sentCount = 0
    let skippedCount = 0
    let nextSendAt: string | null = null
    let attachments: Attachment[] | null = null
    let budget = await getSendBudget(userId, settings)

    const finish = async (reason: DripReason, message: string, extra: Partial<DripResult> = {}): Promise<DripResult> => ({
        success: !['auth', 'gmail_limit', 'bounce_rate'].includes(reason),
        sentCount,
        skippedCount,
        remaining: await opts.countRemaining(),
        nextSendAt,
        reason,
        sentToday: budget.sentLast24h,
        dailyLimit: budget.dailyLimit,
        message,
        errors: errors.length > 0 ? errors : undefined,
        ...extra,
    })

    while (true) {
        const guard = await checkBounceGuard(campaign.id, settings)
        if (guard.paused) {
            return finish('bounce_rate', `Paused: bounce rate ${guard.rate.toFixed(1)}% is above ${settings.max_bounce_rate}%`, { stopped: true })
        }

        // With recipient timezones the window is checked per recipient in fetchNext
        if (!settings.use_recipient_timezone) {
            const window = isWithinSendWindow(settings)
            if (!window.open) return finish('outside_window', window.message)
        }

        if (budget.remaining <= 0) {
            return finish('daily_limit', `Daily limit reached (${budget.sentLast24h}/${budget.dailyLimit} in the last 24h). Sending continues tomorrow.`)
        }

        const slot = await claimSendSlot(userId, settings)
        if (!slot.ok) {
            nextSendAt = slot.nextSendAt
            const waitMs = new Date(slot.nextSendAt).getTime() - Date.now()
            // Leave a few seconds for the actual send before the deadline
            if (Date.now() + waitMs < deadline - 3000) {
                await sleep(Math.max(waitMs, 0) + 200)
                continue
            }
            return finish('waiting', `Next email at ${new Date(slot.nextSendAt).toLocaleTimeString()}`)
        }
        nextSendAt = slot.nextSendAt

        const recipient = await opts.fetchNext(attempted)
        if (recipient === NONE_IN_WINDOW) {
            await releaseSendSlot(userId)
            nextSendAt = null
            return finish('outside_window', `No recipient is inside their local sending hours (${settings.send_window_start}:00-${settings.send_window_end}:00) right now`)
        }
        if (!recipient) {
            await releaseSendSlot(userId)
            nextSendAt = null
            return finish('done', 'All emails sent')
        }
        attempted.push(recipient.id)

        if (opts.prepare) {
            const prep = await opts.prepare(recipient)
            if (prep.skip) {
                skippedCount++
                await releaseSendSlot(userId)
                nextSendAt = null
                if (Date.now() >= deadline) return finish('waiting', 'Continuing shortly')
                continue
            }
        }

        if (!attachments) {
            attachments = []
            // attach_resume=false means the resume goes out as a tracked link ({{resume_url}}) instead
            if (campaign.resume_storage_path && campaign.attach_resume !== false) {
                try {
                    const resume = await downloadResume(campaign.resume_storage_path)
                    if (resume) {
                        attachments.push({ filename: resume.filename, content: resume.content, contentType: 'application/pdf' })
                    }
                } catch (err) {
                    console.error('Error downloading resume:', err)
                }
            }
        }

        const email = opts.buildEmail(recipient, attachments)
        const variables = await withResumeUrl(campaign.id, recipient, `${email.subject}\n${email.body}`)

        let result: SendEmailResult
        try {
            result = await sendEmailViaGmail(
                {
                    access_token: gmailCredential.access_token,
                    refresh_token: gmailCredential.refresh_token,
                    expires_at: gmailCredential.expires_at,
                },
                gmailCredential.email_address,
                { email: recipient.email, name: recipient.name, company: recipient.company, variables },
                email,
                true // verification is handled by prepare()
            )
        } catch (error: any) {
            if (error.message?.includes('invalid_grant') || error.message?.includes('Gmail token')) {
                await opts.supabase.from('campaigns').update({ status: 'paused', paused_reason: 'Gmail token expired. Reconnect Gmail in Settings.' }).eq('id', campaign.id)
                errors.push('Gmail token expired. Please reconnect Gmail in Settings.')
                return finish('auth', 'Gmail token expired. Please reconnect Gmail in Settings.', { stopped: true, authError: true })
            }
            result = { success: false, error: error.message, timestamp: new Date().toISOString() }
        }

        if (result.success) {
            sentCount++
            budget = { ...budget, sentLast24h: budget.sentLast24h + 1, remaining: budget.remaining - 1 }
            await opts.onSent(recipient, result)
        } else if (result.isBlocking) {
            await opts.supabase
                .from('campaigns')
                .update({ status: 'paused', paused_reason: 'Gmail daily sending limit reached', updated_at: new Date().toISOString() })
                .eq('id', campaign.id)
            errors.push('Campaign paused due to Gmail Daily Limit')
            return finish('gmail_limit', 'Gmail daily sending limit reached. Campaign paused.', { stopped: true })
        } else if (result.error?.includes('invalid_grant') || result.error?.includes('Gmail token')) {
            await opts.supabase.from('campaigns').update({ status: 'paused', paused_reason: 'Gmail token expired. Reconnect Gmail in Settings.' }).eq('id', campaign.id)
            errors.push('Gmail token expired. Please reconnect Gmail in Settings.')
            return finish('auth', 'Gmail token expired. Please reconnect Gmail in Settings.', { stopped: true, authError: true })
        } else {
            errors.push(`Failed to send to ${recipient.email}: ${result.error}`)
            await opts.onFailed(recipient, result)
        }

        if (Date.now() >= deadline) return finish('waiting', `Next email at ${new Date(nextSendAt).toLocaleTimeString()}`)
    }
}

/**
 * Recipient variables, plus resume_url when the template uses {{resume_url}} but the
 * recipient was added after the resume link was enabled.
 */
async function withResumeUrl(campaignId: string, recipient: any, template: string): Promise<Record<string, unknown> | null> {
    const variables = recipient.variables || null
    if (!/\{\{\s*resume_url\s*\}\}/i.test(template) || variables?.resume_url) return variables
    try {
        const url = await getResumeUrlForRecipient(campaignId, recipient.id)
        return { ...(variables || {}), resume_url: url || '' }
    } catch (err) {
        console.warn('Resume link lookup failed:', err)
        return { ...(variables || {}), resume_url: '' }
    }
}

async function loadCampaignContext(campaignId: string, userId: string, supabase: any) {
    const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single()

    if (campaignError || !campaign) {
        throw new Error('Campaign not found')
    }

    const { data: gmailCredential, error: gmailError } = await supabase
        .from('gmail_credentials')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (gmailError || !gmailCredential) {
        throw new Error('Gmail account not connected')
    }

    const settings = await getSenderSettings(userId)
    return { campaign, gmailCredential, settings }
}

export async function processCampaignSend(
    campaignId: string,
    userId: string, // Needed to fetch Gmail credentials
    sendImmediately: boolean = true,
    supabaseClient?: any // Optional: Pass authenticated client if available (for manual send)
): Promise<DripResult> {
    // Use passed client (manual user action) or admin client (cron)
    const supabase = supabaseClient || supabaseAdmin
    const { campaign, gmailCredential, settings } = await loadCampaignContext(campaignId, userId, supabase)

    const countPending = async () => {
        const { count } = await supabase
            .from('email_recipients')
            .select('*', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('status', 'pending')
        return count || 0
    }

    const result = await runDrip({
        supabase,
        campaign,
        userId,
        gmailCredential,
        settings,
        countRemaining: countPending,
        fetchNext: async (excludeIds) => {
            const pendingPage = async (offset: number, size: number) => {
                let query = supabase
                    .from('email_recipients')
                    .select('*')
                    .eq('campaign_id', campaignId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: true })
                    .range(offset, offset + size - 1)
                if (excludeIds.length > 0) query = query.not('id', 'in', `(${excludeIds.join(',')})`)
                const { data } = await query
                return data || []
            }
            if (!settings.use_recipient_timezone) {
                const [first] = await pendingPage(0, 1)
                return first || null
            }
            // With recipient timezones, take the first pending recipient inside their business hours
            let sawAny = false
            for (let chunk = 0; chunk < TIMEZONE_PICK_MAX_CHUNKS; chunk++) {
                const rows = await pendingPage(chunk * TIMEZONE_PICK_BATCH, TIMEZONE_PICK_BATCH)
                if (rows.length === 0) break
                sawAny = true
                const inWindow = pickInWindow(rows, settings, settings.timezone)
                if (inWindow) return inWindow
                if (rows.length < TIMEZONE_PICK_BATCH) break
            }
            return sawAny ? NONE_IN_WINDOW : null
        },
        prepare: async (recipient) => {
            // Reuse a recent 'safe' verification, otherwise verify now
            const verifiedRecently = recipient.verification_status === 'safe' &&
                recipient.verified_at &&
                Date.now() - new Date(recipient.verified_at).getTime() < VERIFICATION_TTL_MS
            if (verifiedRecently) return { skip: false }

            const verification = await verifyEmail(recipient.email)
            const verifiedFields = {
                verification_status: verification.status,
                verification_reason: verification.reason || null,
                verified_at: new Date().toISOString(),
            }

            // Only addresses verified as deliverable get an email
            if (verification.status !== 'safe') {
                console.warn(`Skipping ${recipient.email}: ${verification.reason}`)
                await supabase
                    .from('email_recipients')
                    .update({
                        ...verifiedFields,
                        status: 'skipped',
                        error_message: `Skipped: ${verification.reason || verification.status}`,
                    })
                    .eq('id', recipient.id)
                return { skip: true, reason: verification.reason || verification.status }
            }

            await supabase.from('email_recipients').update(verifiedFields).eq('id', recipient.id)
            return { skip: false }
        },
        buildEmail: (recipient, attachments) => ({
            subject: campaign.subject_template,
            body: campaign.email_body_template,
            attachments: attachments.length > 0 ? attachments : undefined,
            trackingPixelUrl: campaign.track_opens ? createOpenTrackingUrl(recipient.id) ?? undefined : undefined,
        }),
        onSent: async (recipient, result) => {
            await supabase
                .from('email_recipients')
                .update({
                    status: 'sent',
                    sent_at: new Date().toISOString(),
                    gmail_message_id: result.messageId,
                    gmail_thread_id: result.threadId,
                    rfc_message_id: result.rfcMessageId || null,
                    error_message: null,
                    ...(settings.use_recipient_timezone && !recipient.timezone
                        ? { timezone: recipientTimezone(recipient, settings.timezone) }
                        : {}),
                })
                .eq('id', recipient.id)

            await supabase.from('email_logs').insert({
                recipient_id: recipient.id,
                event_type: 'sent',
                event_timestamp: new Date().toISOString(),
                metadata: { message_id: result.messageId },
            })

            // Pipeline board is best-effort; it must never block sending
            try {
                await advanceStageByEmail(userId, recipient.email, 'contacted')
            } catch (err) {
                console.warn('Pipeline update failed:', err)
            }
        },
        onFailed: async (recipient, result) => {
            // Auto-block emails that appear to be invalid/bounced
            const errorLower = (result.error || '').toLowerCase()
            const shouldBlock = errorLower.includes('bounced') ||
                errorLower.includes('address') ||
                errorLower.includes('not found') ||
                errorLower.includes('invalid')

            if (shouldBlock) {
                const { error } = await supabase.from('blocked_emails').upsert({
                    email: recipient.email.toLowerCase(),
                    reason: 'bounced',
                    source_campaign_id: campaignId,
                    blocked_at: new Date().toISOString()
                }, { onConflict: 'email' })
                if (error) console.warn('Error adding to blocklist:', error.message)
            }

            await supabase
                .from('email_recipients')
                .update({ status: 'failed', error_message: result.error })
                .eq('id', recipient.id)
        },
    })

    // Final campaign status update (a pause set during the run wins)
    if (sendImmediately && !result.stopped) {
        const newStatus = result.remaining > 0 ? 'scheduled' : 'sent'
        await supabase
            .from('campaigns')
            .update({
                status: newStatus,
                paused_reason: null,
                sent_at: newStatus === 'sent' ? new Date().toISOString() : undefined,
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaignId)
    }

    return { ...result, totalRecipients: result.sentCount + result.remaining }
}

async function loadSteps(supabase: any, campaign: any): Promise<SequenceStep[]> {
    const { data, error } = await supabase
        .from('campaign_steps')
        .select('step_number, delay_days, subject, body')
        .eq('campaign_id', campaign.id)
        .order('step_number', { ascending: true })

    if (error) {
        throw new Error(`Sequences unavailable (${error.message}). Run scripts/11_sequences.sql in Supabase.`)
    }
    return (data || []) as SequenceStep[]
}

/** Company domains in this campaign where somebody already replied. */
async function loadRepliedDomains(supabase: any, campaignId: string): Promise<Set<string>> {
    const { data } = await supabase
        .from('email_recipients')
        .select('email')
        .eq('campaign_id', campaignId)
        .or('status.eq.replied,replied_at.not.is.null')
    const domains = new Set<string>()
    for (const row of data || []) {
        const domain = companyDomainOf(row.email)
        if (domain) domains.add(domain)
    }
    return domains
}

/**
 * Sends the next sequence step (2..N) to recipients who got the previous email and never
 * replied, with the same limits as first emails. onlyDue respects each step's delay.
 * The sequence stops for a recipient once anyone at their company replies.
 */
export async function processSequenceSend(
    campaignId: string,
    userId: string,
    supabaseClient?: any,
    options: { onlyDue: boolean } = { onlyDue: true }
): Promise<DripResult> {
    const supabase = supabaseClient || supabaseAdmin
    const { campaign, gmailCredential, settings } = await loadCampaignContext(campaignId, userId, supabase)

    const steps = await loadSteps(supabase, campaign)
    if (steps.length === 0) {
        throw new Error('No follow-up steps defined')
    }
    const lastStep = steps[steps.length - 1].step_number

    // SQL narrows to recipients that can possibly get a step (sent, no reply, not stopped,
    // not on an out-of-office hold), oldest activity first; the per-step due dates and the
    // colleague rule are checked in JS (checkStepEligibility), one page at a time.
    const loadEligible = async (excludeIds: string[] = [], firstOnly = false) => {
        const repliedDomains = await loadRepliedDomains(supabase, campaignId)
        const nowIso = new Date().toISOString()
        const eligible: Array<{ recipient: any; step: SequenceStep }> = []

        for (let offset = 0; offset < SEQUENCE_MAX_SCAN; offset += SEQUENCE_PAGE_SIZE) {
            let query = supabase
                .from('email_recipients')
                .select('*')
                .eq('campaign_id', campaignId)
                .eq('status', 'sent')
                .is('replied_at', null)
                .not('sequence_stopped', 'is', true)
                .or(`next_step_not_before.is.null,next_step_not_before.lte.${nowIso}`)
                .lt('current_step', lastStep)
                .order('last_step_sent_at', { ascending: true, nullsFirst: true })
                .order('sent_at', { ascending: true })
                .range(offset, offset + SEQUENCE_PAGE_SIZE - 1)
            if (excludeIds.length > 0) query = query.not('id', 'in', `(${excludeIds.join(',')})`)
            const { data, error } = await query
            if (error) throw new Error(`Failed to load recipients: ${error.message}`)

            for (const recipient of data || []) {
                const check = checkStepEligibility(recipient, steps, { onlyDue: options.onlyDue, repliedDomains })
                if (check.eligible) {
                    eligible.push({ recipient, step: check.step })
                } else if (check.reason === 'colleague_replied') {
                    await supabase
                        .from('email_recipients')
                        .update({ sequence_stopped: true, sequence_stop_reason: 'A colleague at the same company replied' })
                        .eq('id', recipient.id)
                }
            }
            if (!data || data.length < SEQUENCE_PAGE_SIZE) break
            // Without recipient timezones the first eligible row is enough
            if (firstOnly && eligible.length > 0 && !settings.use_recipient_timezone) break
            if (firstOnly && eligible.length >= TIMEZONE_PICK_BATCH) break
        }
        return eligible
    }

    // Step chosen for each recipient in fetchNext, read back in buildEmail/onSent
    const stepFor = new Map<string, SequenceStep>()

    return runDrip({
        supabase,
        campaign,
        userId,
        gmailCredential,
        settings,
        countRemaining: async () => (await loadEligible()).length,
        fetchNext: async (excludeIds) => {
            const eligible = await loadEligible(excludeIds, true)
            if (eligible.length === 0) return null
            let chosen = eligible[0]
            if (settings.use_recipient_timezone) {
                const inWindow = pickInWindow(eligible.map(e => e.recipient), settings, settings.timezone)
                if (!inWindow) return NONE_IN_WINDOW
                chosen = eligible.find(e => e.recipient.id === inWindow.id)!
            }
            stepFor.set(chosen.recipient.id, chosen.step)
            return chosen.recipient
        },
        prepare: async (recipient) => {
            // Bounced/unsubscribed addresses must never get another step
            const { data: blocked } = await supabaseAdmin
                .from('blocked_emails')
                .select('reason')
                .eq('email', recipient.email.toLowerCase().trim())
                .maybeSingle()
            if (blocked) {
                await supabase
                    .from('email_recipients')
                    .update({ sequence_stopped: true, sequence_stop_reason: `Blocked: ${blocked.reason}` })
                    .eq('id', recipient.id)
                return { skip: true, reason: `Blocked: ${blocked.reason}` }
            }
            return { skip: false }
        },
        buildEmail: (recipient, attachments) => {
            const step = stepFor.get(recipient.id)!
            const inThread = !step.subject
            return {
                subject: stepSubject(step, campaign.subject_template || ''),
                body: step.body,
                // Threading headers need the RFC Message-ID; Gmail's API id would not thread for the recipient
                inReplyTo: inThread ? recipient.rfc_message_id || undefined : undefined,
                references: inThread ? recipient.rfc_message_id || undefined : undefined,
                threadId: inThread ? recipient.gmail_thread_id || undefined : undefined,
                attachments: attachments.length > 0 ? attachments : undefined,
                trackingPixelUrl: campaign.track_opens ? createOpenTrackingUrl(recipient.id) ?? undefined : undefined,
            }
        },
        onSent: async (recipient, result) => {
            const step = stepFor.get(recipient.id)!
            const now = new Date().toISOString()
            const { error: updateError } = await supabase
                .from('email_recipients')
                .update({
                    current_step: step.step_number,
                    last_step_sent_at: now,
                    next_step_not_before: null,
                    // Step 2 keeps the legacy follow-up columns that analytics read
                    ...(step.step_number === 2 ? { follow_up_sent: true, follow_up_sent_at: now } : {}),
                })
                .eq('id', recipient.id)

            if (updateError) console.error(`[Sequence] DB Update Error for ${recipient.email}:`, updateError)

            await supabase.from('email_logs').insert({
                recipient_id: recipient.id,
                event_type: 'follow_up_sent',
                event_timestamp: now,
                metadata: { message_id: result.messageId, step: step.step_number },
            })
        },
        onFailed: async (recipient, result) => {
            // Blocked addresses (bounced/unsubscribed) must never be retried
            if (result.error?.startsWith('Blocked')) {
                await supabase
                    .from('email_recipients')
                    .update({ sequence_stopped: true, sequence_stop_reason: result.error })
                    .eq('id', recipient.id)
                return
            }
            // Other failures back off a day instead of burning a send slot on every run
            await supabase
                .from('email_recipients')
                .update({ next_step_not_before: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
                .eq('id', recipient.id)
        },
    })
}

/** Kept for existing callers: follow-ups are now sequence steps. */
export async function processFollowUpSend(
    campaignId: string,
    userId: string,
    supabaseClient?: any,
    options: { onlyDue: boolean } = { onlyDue: true }
): Promise<DripResult> {
    return processSequenceSend(campaignId, userId, supabaseClient, options)
}

/** Holds the next step until a date, e.g. when an out-of-office reply names a return date. */
export async function rescheduleFollowUp(recipientId: string, notBefore: Date): Promise<void> {
    const { error } = await supabaseAdmin
        .from('email_recipients')
        .update({ next_step_not_before: notBefore.toISOString() })
        .eq('id', recipientId)
    if (error) throw new Error(`Failed to reschedule follow-up: ${error.message}`)
}
