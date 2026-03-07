import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { z } from 'zod'

// Validation Schemas
const campaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  followUpTemplate: z.string().nullable().optional(),
  resume_storage_path: z.string().nullable().optional(),
  sender_email: z.string().optional().default('gmail'),
})

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()

  // Fetch campaigns with recipient counts calculated from email_recipients table
  const { data: campaigns, error: campaignsError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (campaignsError) {
    console.error('Database Error:', campaignsError)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  // For each campaign, get real counts from email_recipients
  const mappedData = await Promise.all((campaigns || []).map(async (campaign) => {
    // Get recipient counts
    const { count: totalCount } = await supabase
      .from('email_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)

    const { count: sentCount } = await supabase
      .from('email_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .in('status', ['sent', 'replied'])

    return {
      ...campaign,
      recipients_count: totalCount || 0,
      sent_count: sentCount || 0,
    }
  }))

  return NextResponse.json(mappedData)
}

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const json = await request.json()
    const body = campaignSchema.parse(json)

    const supabase = await getSupabaseServerClient()

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        user_id: user.id,
        name: body.name,
        subject_template: body.subject,
        email_body_template: body.body,
        follow_up_template: body.followUpTemplate || null,
        resume_storage_path: body.resume_storage_path || null,
        sender_email: body.sender_email,
        status: 'draft',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Database Insertion Error:', error)
      return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

