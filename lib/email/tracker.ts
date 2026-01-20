import { google } from 'googleapis'

interface GmailToken {
  access_token: string
  refresh_token?: string
  expires_at?: number
}

export async function checkForReplies(
  tokens: GmailToken,
  fromEmail: string,
  messageId: string
) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/gmail/callback`
    )

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Get the original message to find the thread
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    })

    const threadId = message.data.threadId

    // Get all messages in the thread
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId || '',
      format: 'full',
    })

    if (!thread.data.messages || thread.data.messages.length <= 1) {
      return {
        hasReply: false,
        replyContent: null,
      }
    }

    // Check if there are messages after the original
    const messages = thread.data.messages
    const originalIndex = messages.findIndex((m) => m.id === messageId)

    if (originalIndex === messages.length - 1) {
      // This is the last message, so no reply yet
      return {
        hasReply: false,
        replyContent: null,
      }
    }

    // Get the reply message
    const replyMessage = messages[messages.length - 1]
    const replyHeaders = replyMessage.payload?.headers || []
    const fromHeader = replyHeaders.find((h) => h.name === 'From')
    const subjectHeader = replyHeaders.find((h) => h.name === 'Subject')

    // Get email body
    let replyBody = ''
    if (replyMessage.payload?.parts) {
      const textPart = replyMessage.payload.parts.find(
        (part) => part.mimeType === 'text/plain'
      )
      if (textPart?.body?.data) {
        replyBody = Buffer.from(textPart.body.data, 'base64').toString()
      }
    } else if (replyMessage.payload?.body?.data) {
      replyBody = Buffer.from(replyMessage.payload.body.data, 'base64').toString()
    }

    return {
      hasReply: true,
      replyContent: {
        from: fromHeader?.value || 'Unknown',
        subject: subjectHeader?.value || 'No Subject',
        body: replyBody,
        timestamp: replyMessage.internalDate
          ? new Date(parseInt(replyMessage.internalDate)).toISOString()
          : new Date().toISOString(),
      },
    }
  } catch (error) {
    console.error('Error checking for replies:', error)
    return {
      hasReply: false,
      replyContent: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function syncCampaignReplies(
  tokens: GmailToken,
  campaignId: string,
  emailLogs: Array<{ id: string; message_id: string; recipient_email: string }>
) {
  const results = []

  for (const log of emailLogs) {
    const reply = await checkForReplies(tokens, '', log.message_id)
    results.push({
      logId: log.id,
      recipientEmail: log.recipient_email,
      hasReply: reply.hasReply,
      replyContent: reply.replyContent,
    })
  }

  return results
}
