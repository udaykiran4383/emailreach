import { google } from 'googleapis'

export interface GmailConfig {
  accessToken: string
  refreshToken?: string
}

export function createGmailClient(config: GmailConfig) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/gmail/callback`
  )

  oauth2Client.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

export interface EmailToSend {
  to: string
  subject: string
  body: string
  replyTo?: string
}

export async function sendEmail(gmail: any, email: EmailToSend) {
  const message = [
    `From: ${process.env.GMAIL_FROM_EMAIL || 'noreply@example.com'}`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Reply-To: ${email.replyTo || process.env.GMAIL_FROM_EMAIL || 'noreply@example.com'}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    email.body,
  ].join('\n')

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    })

    return {
      success: true,
      messageId: response.data.id,
    }
  } catch (error) {
    console.error('Error sending email:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function getEmailThread(gmail: any, threadId: string) {
  try {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    })

    return response.data
  } catch (error) {
    console.error('Error fetching thread:', error)
    return null
  }
}
