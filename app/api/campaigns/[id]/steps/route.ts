import { getSupabaseServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { normalizeSteps } from '@/lib/campaigns/sequence-logic'

async function loadOwnedCampaign(id: string, userId: string) {
  const supabase = await getSupabaseServerClient()
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, subject_template, email_body_template')
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  return { supabase, campaign }
}

async function loadStepsWithStats(supabase: any, campaignId: string) {
  const [{ data: steps, error }, { data: recipients }] = await Promise.all([
    supabase
      .from('campaign_steps')
      .select('step_number, delay_days, subject, body')
      .eq('campaign_id', campaignId)
      .order('step_number', { ascending: true }),
    supabase
      .from('email_recipients')
      .select('status, current_step, sent_at, sequence_stopped')
      .eq('campaign_id', campaignId),
  ])
  if (error) throw new Error(`${error.message}. Run scripts/11_sequences.sql in Supabase.`)

  // Emails sent per step: a recipient at current_step N received steps 1..N
  const sentPerStep: Record<number, number> = {}
  let stopped = 0
  for (const r of recipients || []) {
    if (!r.sent_at) continue
    const reached = r.current_step || 1
    for (let n = 1; n <= reached; n++) sentPerStep[n] = (sentPerStep[n] || 0) + 1
    if (r.sequence_stopped) stopped++
  }
  return { steps: steps || [], stats: { sentPerStep, stopped } }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { supabase, campaign } = await loadOwnedCampaign(id, user.id)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  try {
    return NextResponse.json(await loadStepsWithStats(supabase, id))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/** Replaces all follow-up steps (2..N) with the given list, in order. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { supabase, campaign } = await loadOwnedCampaign(id, user.id)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const { steps, error: validationError } = normalizeSteps(body?.steps)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const { error: deleteError } = await supabase.from('campaign_steps').delete().eq('campaign_id', id)
  if (deleteError) {
    return NextResponse.json({ error: `${deleteError.message}. Run scripts/11_sequences.sql in Supabase.` }, { status: 500 })
  }

  if (steps.length > 0) {
    const { error: insertError } = await supabase
      .from('campaign_steps')
      .insert(steps.map(step => ({ ...step, campaign_id: id })))
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Keep the legacy single follow-up columns in sync with step 2 (analytics and older code read them)
  const second = steps[0]
  await supabase
    .from('campaigns')
    .update({
      follow_up_template: second ? second.body : null,
      ...(second ? { follow_up_days: second.delay_days } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  try {
    return NextResponse.json(await loadStepsWithStats(supabase, id))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
