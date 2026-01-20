import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

interface Recipient {
  email: string
  name?: string
  company?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { recipients } = await request.json()

  const supabase = await getSupabaseServerClient()

  // Verify campaign exists
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Insert recipients in batches to avoid timeout/size issues
  const recipientRows = recipients.map((r: Recipient) => ({
    campaign_id: id,
    email: r.email,
    name: r.name || r.email.split('@')[0], // Use email prefix if name is empty
    company: r.company || null,
    status: 'pending',
  }))

  // Batch insert - 200 at a time
  const batchSize = 200
  let insertedCount = 0
  const errors: string[] = []

  for (let i = 0; i < recipientRows.length; i += batchSize) {
    const batch = recipientRows.slice(i, i + batchSize)
    const { error } = await supabase
      .from('email_recipients')
      .insert(batch)

    if (error) {
      errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`)
    } else {
      insertedCount += batch.length
    }
  }

  if (errors.length > 0 && insertedCount === 0) {
    return NextResponse.json({ error: errors.join(', ') }, { status: 500 })
  }

  // Update campaign recipient count
  const { count: totalCount } = await supabase
    .from('email_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', id)

  await supabase
    .from('campaigns')
    .update({ total_recipients: totalCount || insertedCount })
    .eq('id', id)

  return NextResponse.json({
    success: true,
    count: insertedCount,
    errors: errors.length > 0 ? errors : undefined
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = await getSupabaseServerClient()

  // Verify campaign exists
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('email_recipients')
    .select('*')
    .eq('campaign_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data || [])
}
