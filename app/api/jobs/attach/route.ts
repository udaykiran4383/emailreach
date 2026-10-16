import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth/actions'
import { mergeRecipientVariablesBulk } from '@/lib/db/atomic'

/**
 * Stores a job's details on every recipient of a campaign whose email domain matches,
 * so templates can use {{job_title}}, {{job_url}} and {{job_location}}.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { campaignId?: unknown; domain?: unknown; job?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
  const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase().replace(/^www\./, '') : ''
  const job = body.job || {}
  const title = typeof job.title === 'string' ? job.title.trim().slice(0, 300) : ''
  const url = typeof job.url === 'string' && /^https?:\/\//i.test(job.url) ? job.url.slice(0, 2000) : ''
  const location = typeof job.location === 'string' ? job.location.trim().slice(0, 300) : ''
  if (!campaignId || !domain || !title) {
    return NextResponse.json({ error: 'campaignId, domain and job.title are required' }, { status: 400 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', user.id)
    .single()
  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Match the domain and its subdomains (jane@eng.acme.com belongs to acme.com)
  const { data: recipients, error } = await supabase
    .from('email_recipients')
    .select('id, email')
    .eq('campaign_id', campaignId)
    .ilike('email', `%${domain}`)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const matching = (recipients || []).filter((r: { email: string }) => {
    const host = r.email.toLowerCase().split('@')[1] || ''
    return host === domain || host.endsWith(`.${domain}`)
  })

  // Atomic merge: other keys (opener, resume_url, ...) written concurrently are kept
  const updated = await mergeRecipientVariablesBulk(
    (matching as Array<{ id: string }>).map((r) => r.id),
    { job_title: title, job_url: url, job_location: location }
  )

  return NextResponse.json({ success: true, updated, matched: matching.length })
}
