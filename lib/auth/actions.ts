'use server'

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signUp(email: string, password: string) {
  try {
    const supabase = await getSupabaseServerClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/auth/callback`,
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
    return { error: 'An error occurred during sign in' }
  }
}

export async function signOut() {
  try {
    const supabase = await getSupabaseServerClient()
    await supabase.auth.signOut()
    redirect('/auth/login')
  } catch (error) {
    redirect('/auth/login')
  }
}

export async function getUser() {
  // Always return personal-user for simplified "No Login" mode
  return {
    id: 'personal-user',
    email: 'udayyennampelly0@gmail.com',
    user_metadata: { full_name: 'Uday' },
    aud: 'authenticated',
    app_metadata: {},
    created_at: new Date().toISOString()
  } as any
}
