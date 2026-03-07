'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.URL) return process.env.URL // Netlify sets this automatically
  return 'http://localhost:3000'
}

export async function signUp(email: string, password: string) {
  try {
    const supabase = await getSupabaseServerClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${getBaseUrl()}/auth/callback`,
      },
    })

    if (error) {
      return { error: error.message }
    }

    return { success: true }
  } catch (error) {
    return { error: 'An error occurred during sign up' }
  }
}

export async function signIn(email: string, password: string) {
  try {
    const supabase = await getSupabaseServerClient()

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return { error: error.message }
    }

    redirect('/dashboard')
  } catch (error) {
    // Redirect throws an error, so we need to rethrow it if it's a redirect
    if ((error as any).digest?.startsWith('NEXT_REDIRECT')) {
      throw error
    }
    return { error: 'An error occurred during sign in' }
  }
}

export async function signInWithGoogle() {
  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${getBaseUrl()}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  if (data.url) {
    redirect(data.url)
  }

  return { error: 'Unknown error occurred' }
}

export async function signOut() {
  try {
    const supabase = await getSupabaseServerClient()
    await supabase.auth.signOut()
    redirect('/auth/login')
  } catch (error) {
    if ((error as any).digest?.startsWith('NEXT_REDIRECT')) {
      throw error
    }
    redirect('/auth/login')
  }
}

export async function getUser() {
  const supabase = await getSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
