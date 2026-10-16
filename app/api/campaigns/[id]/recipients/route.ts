import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'

interface Recipient {
  email: string
  name?: string
  company?: string
  verification_status?: 'safe' | 'risky' | 'invalid'
  verification_reason?: string
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

  // Normalize and dedupe within the upload
  const seen = new Set<string>()
  let duplicates = 0
  const cleaned: Recipient[] = []
  for (const r of (recipients || []) as Recipient[]) {
    const email = (r.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    if (seen.has(email)) {
      duplicates++
      continue
    }
    seen.add(email)
    cleaned.push({ ...r, email })
  }

  // Skip addresses already in this campaign
  const { data: existing } = await supabase
    .from('email_recipients')
    .select('email')
    .eq('campaign_id', id)
  const existingEmails = new Set((existing || []).map((r: { email: string }) => r.email.trim().toLowerCase()))

  // Skip addresses that bounced or unsubscribed before
  const blockedEmails = new Set<string>()
  const emails = cleaned.map(r => r.email)
  for (let i = 0; i < emails.length; i += 500) {
    const { data: blocked } = await supabase
      .from('blocked_emails')
      .select('email')
      .in('email', emails.slice(i, i + 500))
    blocked?.forEach((b: { email: string }) => blockedEmails.add(b.email))
  }

  let blockedCount = 0
  const toInsert = cleaned.filter(r => {
    if (existingEmails.has(r.email)) {
      duplicates++
      return false
    }
    if (blockedEmails.has(r.email)) {
      blockedCount++
      return false
    }
    return true
  })

  const now = new Date().toISOString()
  const recipientRows = toInsert.map((r: Recipient) => {
    const invalid = r.verification_status === 'invalid'
    return {
      campaign_id: id,
      email: r.email,
      name: r.name || r.email.split('@')[0], // Use email prefix if name is empty
      company: r.company || null,
      status: invalid ? 'skipped' : 'pending',
      error_message: invalid ? `Skipped: ${r.verification_reason || 'Invalid email'}` : null,
      ...(r.verification_status ? {
        verification_status: r.verification_status,
        verification_reason: r.verification_reason || null,
        verified_at: now,
      } : {}),
    }
  })

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
    duplicates,
    blocked: blockedCount,
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
