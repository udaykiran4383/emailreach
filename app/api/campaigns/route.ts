import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await getSupabaseServerClient()

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Map database field names to frontend expected names
  const mappedData = (data || []).map(campaign => ({
    ...campaign,
    recipients_count: campaign.total_recipients || 0,
    sent_count: campaign.sent_emails || 0,
  }))

  return NextResponse.json(mappedData)
}

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
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
      status: 'draft',
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

