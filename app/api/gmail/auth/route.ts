import { google } from 'googleapis'
import { NextResponse } from 'next/server'

function getRedirectUri() {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI
  if (process.env.NEXT_PUBLIC_SITE_URL) return `${process.env.NEXT_PUBLIC_SITE_URL}/api/gmail/callback`
  if (process.env.URL) return `${process.env.URL}/api/gmail/callback`
  return 'http://localhost:3000/api/gmail/callback'
}

export async function GET() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    getRedirectUri()
  )

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ]

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  })

  return NextResponse.redirect(authUrl)
}
