import { google } from 'googleapis'
import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { verifyEmailDNS } from './verifier'
import { createClient } from '@supabase/supabase-js'

// Rate limiting utilities
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Supabase admin client for blocklist checks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

/**
 * Check if an email is in the blocklist (previously bounced or invalid)
 */
async function isEmailBlocked(email: string): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('blocked_emails')
      .select('reason')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found (not an error for us)
      console.warn('Error checking blocklist:', error.message)
      return { blocked: false }
    }

    if (data) {
      return { blocked: true, reason: data.reason }
    }

    return { blocked: false }
  } catch (err) {
    console.warn('Error checking blocklist:', err)
    return { blocked: false }
  }
}

/**
 * Add an email to the blocklist
 */
export async function blockEmail(email: string, reason: string, campaignId?: string): Promise<void> {
  try {
    await supabaseAdmin.from('blocked_emails').upsert({
      email: email.toLowerCase().trim(),
      reason,
      source_campaign_id: campaignId || null,
      blocked_at: new Date().toISOString()
    }, { onConflict: 'email' })
  } catch (err) {
    console.warn('Error adding to blocklist:', err)
  }
}


/**
 * Retry wrapper with exponential backoff for Gmail API rate limits
 * Optional onRateLimit callback to report retries to caller
 */
async function sendWithRetry<T>(
  sendFn: () => Promise<T>,
  maxAttempts: number = 5,
  attempt: number = 1,
  onRateLimit?: (attempt: number, maxAttempts: number, waitSeconds: number) => void
): Promise<T> {
  try {
    return await sendFn()
  } catch (err: any) {
    const isRateLimit = err.code === 429
    // Handle network errors (EPROTO, ECONNRESET, ETIMEDOUT)
    const isNetworkError =
      err.code === 'EPROTO' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.message?.includes('EPROTO') ||
      err.message?.includes('socket hang up')

    // Don't retry on auth errors (invalid_grant) or bad requests
    if (err.code === 400 || err.code === 401 || err.message?.includes('invalid_grant')) {
      console.error('Fatal Auth Error: Gmail token is invalid or expired. Reconnect Gmail.')
      throw err
    }

    // Check for Daily Limit Exceeded
    if (err.message?.includes('limit for sending mail') || err.message?.includes('Daily Limit Exceeded')) {
      console.error('Fatal: Gmail Daily Limit Reached.')
      throw new Error('GMAIL_DAILY_LIMIT_REACHED')
    }

    if ((isRateLimit || isNetworkError) && attempt < maxAttempts) {
      // Default wait time (exponential backoff)
      let waitMs = Math.min(2 ** attempt * 2000, 60000)

      // If specific retry-after header exists, use it
      const retryAfterMatch = err.message?.match(/Retry after ([\d-T:.Z]+)/)
      if (retryAfterMatch) {
        const retryTime = new Date(retryAfterMatch[1]).getTime()
        const now = Date.now()
        if (retryTime > now) {
          waitMs = Math.min(retryTime - now + 1000, 120000) // max 2 min wait
        }
      }

      const waitSeconds = Math.round(waitMs / 1000)
      const reason = isRateLimit ? 'Rate limit' : `Network error (${err.code || err.message})`
      console.warn(`${reason} (attempt ${attempt}/${maxAttempts}). Waiting ${waitSeconds}s before retry...`)

      // Notify caller about rate limit
      if (onRateLimit) {
        onRateLimit(attempt, maxAttempts, waitSeconds)
      }

      await sleep(waitMs)
      return sendWithRetry(sendFn, maxAttempts, attempt + 1, onRateLimit)
    }
    throw err
  }
}

interface GmailToken {
  access_token: string
  refresh_token?: string
  expires_at?: number
}

interface Recipient {
  email: string
  name?: string
  company?: string
}

// Result type for sendEmailViaGmail
export interface SendEmailResult {
  success: boolean
  messageId?: string
  threadId?: string
  error?: string
  isBlocking?: boolean // True if error should stop campaign (e.g., daily limit)
  rateLimitInfo?: { attempt: number; maxAttempts: number; waitSeconds: number }
  timestamp: string
}

interface Attachment {
  filename: string
  content?: Buffer | string
  contentType?: string
  path?: string
  cid?: string
  contentDisposition?: 'attachment' | 'inline'
}

interface EmailContent {
  subject: string
  body: string
  inReplyTo?: string
  references?: string
  threadId?: string
  attachments?: Attachment[]
}

export async function personalizeEmail(
  content: EmailContent,
  recipient: Recipient
): Promise<EmailContent> {
  let subject = content.subject
  let body = content.body

  // Replace placeholders
  const placeholders = {
    '{{name}}': recipient.name || recipient.email.split('@')[0],
    '{{email}}': recipient.email,
    '{{company}}': recipient.company || 'there',
  }

  Object.entries(placeholders).forEach(([placeholder, value]) => {
    subject = subject.replace(new RegExp(placeholder, 'g'), value)
    body = body.replace(new RegExp(placeholder, 'g'), value)
  })

  return { ...content, subject, body }
}

/**
 * Converts plain text email body to professional HTML email.
 * Handles bullet points, paragraphs, and proper spacing.
 */
export function generateProfessionalHtmlEmail(plainTextBody: string, senderName: string = ''): string {
  const lines = plainTextBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  let html = ''
  let inList = false
  let currentParagraph = ''

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      html += `<p style="margin: 0 0 16px 0; line-height: 1.6;">${currentParagraph.trim()}</p>\n`
      currentParagraph = ''
    }
  }

  const startList = () => {
    if (!inList) {
      flushParagraph()
      html += '<ul style="margin: 0 0 16px 0; padding-left: 24px; line-height: 1.6;">\n'
      inList = true
    }
  }

  const endList = () => {
    if (inList) {
      html += '</ul>\n'
      inList = false
    }
  }

  for (const line of lines) {
    const trimmedLine = line.trim()

    // Check for bullet point (*, -, •)
    const bulletMatch = trimmedLine.match(/^[\*\-•]\s*(.+)$/)
    if (bulletMatch) {
      startList()
      html += `  <li style="margin-bottom: 6px;">${bulletMatch[1]}</li>\n`
      continue
    }

    // Empty line = paragraph break
    if (trimmedLine === '') {
      endList()
      flushParagraph()
      continue
    }

    // Regular text line
    endList()
    if (currentParagraph) {
      currentParagraph += ' ' + trimmedLine
    } else {
      currentParagraph = trimmedLine
    }
  }

  // Flush any remaining content
  endList()
  flushParagraph()

  // Wrap in a clean email container
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0;">
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #1f2937; line-height: 1.6;">
    ${html}
  </div>
</body>
</html>
  `.trim()
}

export async function sendEmailViaGmail(
  tokens: GmailToken,
  from: string,
  recipient: Recipient,
  email: EmailContent,
  skipVerification: boolean = false
): Promise<SendEmailResult> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/gmail/callback`
  )

  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })

  // Check if token needs refresh
  if (tokens.expires_at && tokens.expires_at < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken()
      tokens.access_token = credentials.access_token || tokens.access_token
      tokens.expires_at = credentials.expiry_date || undefined
    } catch (error) {
      console.error('Error refreshing token:', error)
      throw new Error('Failed to refresh Gmail token')
    }
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  // Check blocklist first (fastest check)
  const blockCheck = await isEmailBlocked(recipient.email)
  if (blockCheck.blocked) {
    console.warn(`Skipping blocked email ${recipient.email}: ${blockCheck.reason}`)
    return {
      success: false,
      error: `Blocked: ${blockCheck.reason || 'Previously bounced'}`,
      timestamp: new Date().toISOString(),
    }
  }

  // Verify email DNS before sending (skip if already pre-verified)
  if (!skipVerification) {
    const verificationResult = await verifyEmailDNS(recipient.email)
    if (verificationResult.status !== 'safe') {
      console.warn(`Skipping email to ${recipient.email}: ${verificationResult.reason}`)
      return {
        success: false,
        error: `Skipped: ${verificationResult.reason}`,
        timestamp: new Date().toISOString(),
      }
    }

    // Log warning if SMTP check failed/skipped but proceed anyway (corporate servers often timeout)
    if (verificationResult.details?.smtp?.status === 'risky') {
      console.warn(`SMTP Verification incomplete for ${recipient.email} (Reason: ${verificationResult.details.smtp.reason}). Proceeding based on valid MX records.`)
    }
  }

  // Personalize email
  const personalizedEmail = await personalizeEmail(email, recipient)

  // Use Nodemailer to generate the raw MIME message
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  })

  try {
    const senderName = from.match(/^"?([^"<]+)"?\s*<.*>$/)?.[1] || from.split('<')[0].trim() || 'Sender'

    // Prepare attachments (user-provided only, no hardcoded logos)
    const finalAttachments: any[] = [...(personalizedEmail.attachments || [])]

    const mailOptions: any = {
      from: from,
      to: recipient.email,
      subject: personalizedEmail.subject,
      text: personalizedEmail.body, // Plain text fallback
      html: generateProfessionalHtmlEmail(personalizedEmail.body, senderName),
      attachments: finalAttachments,
    }

    if (personalizedEmail.inReplyTo) {
      mailOptions.inReplyTo = personalizedEmail.inReplyTo
    }
    if (personalizedEmail.references) {
      mailOptions.references = personalizedEmail.references
    }

    const info = await transporter.sendMail(mailOptions)
    const rawMessage = info.message.toString()

    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Track rate limit retries
    let rateLimitInfo: { attempt: number; maxAttempts: number; waitSeconds: number } | null = null

    const response = await sendWithRetry(
      () =>
        gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedMessage,
            threadId: personalizedEmail.threadId,
          },
        }),
      5,
      1,
      (attempt, maxAttempts, waitSeconds) => {
        rateLimitInfo = { attempt, maxAttempts, waitSeconds }
      }
    )

    return {
      success: true,
      messageId: response.data.id ?? undefined,
      threadId: response.data.threadId ?? undefined,
      timestamp: new Date().toISOString(),
      rateLimitInfo: rateLimitInfo ?? undefined, // Include if any retries happened
    }
  } catch (error: any) {
    console.error('Error sending email to', recipient.email, error)

    // Check if it's the specific rate limit error
    const isRateLimit = error.message === 'GMAIL_DAILY_LIMIT_REACHED' || error.message?.includes('limit for sending mail')

    return {
      success: false,
      error: isRateLimit ? 'GMAIL_DAILY_LIMIT_REACHED' : (error instanceof Error ? error.message : 'Unknown error'),
      isBlocking: isRateLimit, // Flag to tell the caller to stop
      timestamp: new Date().toISOString(),
    }
  }
}




/**
 * Send email via SMTP (for any SMTP server)
 */
export async function sendEmailViaSMTP(
  smtpConfig: {
    host: string
    port: number
    secure: boolean
    user: string
    password: string
  },
  from: string,
  recipient: { email: string; name?: string; company?: string },
  email: { subject: string; body: string; inReplyTo?: string; references?: string; attachments?: any[] }
) {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.password,
    },
  })

  // Check blocklist first (fastest check)
  const blockCheck = await isEmailBlocked(recipient.email)
  if (blockCheck.blocked) {
    console.warn(`Skipping blocked email ${recipient.email}: ${blockCheck.reason}`)
    return {
      success: false,
      error: `Blocked: ${blockCheck.reason || 'Previously bounced'}`,
      timestamp: new Date().toISOString(),
    }
  }

  // Verify email DNS before sending
  const verificationResult = await verifyEmailDNS(recipient.email)
  if (verificationResult.status !== 'safe') {
    console.warn(`Skipping email to ${recipient.email}: ${verificationResult.reason}`)
    return {
      success: false,
      error: `Skipped: ${verificationResult.reason}`,
      timestamp: new Date().toISOString(),
    }
  }

  // Log warning if SMTP check failed/skipped but proceed anyway (corporate servers often timeout)
  if (verificationResult.details?.smtp?.status === 'risky') {
    console.warn(`SMTP Verification incomplete for ${recipient.email} (Reason: ${verificationResult.details.smtp.reason}). Proceeding based on valid MX records.`)
  }

  // Personalize email
  const personalizedEmail = await personalizeEmail(email, recipient)

  const senderName = from.match(/^"?([^"<]+)"?\s*<.*>$/)?.[1] || from.split('<')[0].trim() || 'Sender'

  try {
    // Prepare attachments (user-provided only)
    const finalAttachments: any[] = personalizedEmail.attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
      path: att.path,
    })) || []

    const mailOptions: nodemailer.SendMailOptions = {
      from: from,
      to: recipient.email,
      subject: personalizedEmail.subject,
      text: personalizedEmail.body,
      html: generateProfessionalHtmlEmail(personalizedEmail.body, senderName),
      attachments: finalAttachments,
    }

    if (personalizedEmail.inReplyTo) {
      mailOptions.inReplyTo = personalizedEmail.inReplyTo
    }
    if (personalizedEmail.references) {
      mailOptions.references = personalizedEmail.references
    }

    const info = await transporter.sendMail(mailOptions)

    return {
      success: true,
      messageId: info.messageId,
      threadId: undefined, // SMTP doesn't have thread IDs like Gmail
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error('Error sending SMTP email to', recipient.email, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }
  }
}
