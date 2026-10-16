import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

/**
 * Saves the Gmail tokens Google returned with "Sign in with Google", so the
 * user doesn't have to connect Gmail separately. Best-effort: login still
 * succeeds if this fails, and Settings → Connect Gmail remains available.
 */
async function saveGmailFromLogin(userId: string, accessToken: string, refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET)
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })

  // Only store the tokens if the user actually granted Gmail send access
  const info = await oauth2Client.getTokenInfo(accessToken)
  if (!info.scopes?.includes(GMAIL_SEND_SCOPE)) return

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
  const profile = await gmail.users.getProfile({ userId: 'me' })

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  await admin.from('gmail_credentials').delete().eq('user_id', userId)
  const { error } = await admin.from('gmail_credentials').insert({
    user_id: userId,
    email_address: profile.data.emailAddress,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expiry: info.expiry_date ? new Date(info.expiry_date).toISOString() : null,
  })
  if (error) throw error
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Ignore
            }
          },
        },
      }
    )

    const { data } = await supabase.auth.exchangeCodeForSession(code)
    const session = data?.session

    // Google only returns a refresh token with access_type=offline + prompt=consent
    if (session?.user && session.provider_token && session.provider_refresh_token) {
      try {
        await saveGmailFromLogin(session.user.id, session.provider_token, session.provider_refresh_token)
      } catch (err) {
        console.error('Could not save Gmail connection from Google login:', err)
      }
    }
  }

  return NextResponse.redirect(
    new URL('/dashboard', request.url)
  )
}
