import { google } from 'googleapis'
import nodemailer from 'nodemailer'

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

interface Attachment {
  filename: string
  content: Buffer | string
  contentType?: string
  path?: string
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
function generateProfessionalHtmlEmail(plainTextBody: string): string {
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

  // Wrap in a professional email container
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 600px; margin: 0 auto;">
          <tr>
            <td style="background-color: #ffffff; padding: 32px 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #1f2937;">
              ${html}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

export async function sendEmailViaGmail(
  tokens: GmailToken,
  from: string,
  recipient: Recipient,
  email: EmailContent
) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/gmail/callback`
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

  // Personalize email
  const personalizedEmail = await personalizeEmail(email, recipient)

  // Use Nodemailer to generate the raw MIME message
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  })

  try {
    const mailOptions: any = {
      from: from,
      to: recipient.email,
      subject: personalizedEmail.subject,
      text: personalizedEmail.body, // Plain text fallback
      html: generateProfessionalHtmlEmail(personalizedEmail.body),
      attachments: personalizedEmail.attachments,
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

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId: personalizedEmail.threadId,
      },
    })

    return {
      success: true,
      messageId: response.data.id,
      threadId: response.data.threadId,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error('Error sending email to', recipient.email, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }
  }
}




/**
 * Send email via SMTP (for IITB email or any SMTP server)
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

  // Personalize email
  const personalizedEmail = await personalizeEmail(email, recipient)

  try {
    const mailOptions: nodemailer.SendMailOptions = {
      from: from,
      to: recipient.email,
      subject: personalizedEmail.subject,
      text: personalizedEmail.body,
      html: generateProfessionalHtmlEmail(personalizedEmail.body),
      attachments: personalizedEmail.attachments?.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
        path: att.path,
      })),
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

/**
 * Get IITB SMTP configuration
 */
export function getIITBSMTPConfig() {
  return {
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // Use STARTTLS
    user: process.env.IITB_EMAIL || '',
    password: process.env.IITB_PASSWORD || '',
  }
}
