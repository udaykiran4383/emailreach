import { google } from 'googleapis'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

export async function GET(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL('/auth/login?error=unauthorized_gmail_connect', request.url)
    )
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard/settings?error=${encodeURIComponent(error)}`, request.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=no_code', request.url)
    )
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/gmail/callback`
    )

    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get email from Gmail API
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    const profile = await gmail.users.getProfile({ userId: 'me' })
    const emailAddress = profile.data.emailAddress

    const supabase = await getSupabaseServerClient()

    // Delete existing credentials for this user (replace)
    await supabase
      .from('gmail_credentials')
      .delete()
      .eq('user_id', user.id)

    // Store new credentials
    const { error: dbError } = await supabase
      .from('gmail_credentials')
      .insert({
        user_id: user.id,
        email_address: emailAddress,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      })

    if (dbError) {
      console.error('Database error:', dbError)
      throw dbError
    }

    return NextResponse.redirect(
      new URL('/dashboard/settings?success=true', request.url)
    )
  } catch (error) {
    console.error('Error in Gmail callback:', error)
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=callback_failed', request.url)
    )
  }
}
