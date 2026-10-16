import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth/actions'
import { isAiEnabled } from '@/lib/ai/client'
import { AiDisabledError, companyDomainFromEmail, generateOpener } from '@/lib/ai/personalize'
import { mergeRecipientVariables } from '@/lib/db/atomic'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const TIME_BUDGET_MS = 20_000
const CONCURRENCY = 3

interface RecipientRow {
  id: string
  email: string
  name: string | null
  company: string | null
  status: string
  variables: Record<string, unknown> | null
}

/**
 * Merge keys into recipient.variables without dropping keys other features rely on (job_title, ...).
 *
 * Generated text lives in `opener_draft`; only an approved opener is copied to `opener`,
 * which is the key the sender substitutes for {{opener}}. Unapproved drafts never go out.
 */
async function mergeVariables(
  recipientId: string,
  patch: Record<string, unknown> | ((current: Record<string, unknown>) => Record<string, unknown>)
) {
  let resolved: Record<string, unknown>
  if (typeof patch === 'function') {
    const { data } = await supabaseAdmin
      .from('email_recipients')
      .select('variables')
      .eq('id', recipientId)
      .single()
    resolved = patch((data?.variables as Record<string, unknown>) || {})
  } else {
    resolved = patch
  }
  // Only the patch keys are written, atomically, so concurrent writers of other keys aren't lost
  return mergeRecipientVariables(recipientId, resolved)
}

/**
 * POST body:
 *   { action?: 'generate', recipientIds?: string[], overwrite?: boolean }  -> generate openers (time-boxed, call again until remaining = 0)
 *   { action: 'save', recipientId, opener, approved? }                    -> manual edit
 *   { action: 'approve', recipientId, approved }                           -> approve/unapprove
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action: string = body.action || 'generate'
  const supabase = await getSupabaseServerClient()

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  if (action === 'save' || action === 'approve') {
    const recipientId = String(body.recipientId || '')
    const { data: recipient } = await supabaseAdmin
      .from('email_recipients')
      .select('id')
      .eq('id', recipientId)
      .eq('campaign_id', id)
      .single()
    if (!recipient) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }

    const patch = (current: Record<string, unknown>): Record<string, unknown> => {
      if (action === 'save') {
        const draft = String(body.opener ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
        const approved = typeof body.approved === 'boolean' ? body.approved : Boolean(current.opener_approved)
        return {
          opener_draft: draft,
          opener_confidence: 'manual',
          opener_approved: approved && Boolean(draft),
          opener: approved ? draft : '',
        }
      }
      const draft = String(current.opener_draft ?? '')
      const approved = Boolean(body.approved) && Boolean(draft)
      return { opener_approved: approved, opener: approved ? draft : '' }
    }

    try {
      const variables = await mergeVariables(recipientId, patch)
      return NextResponse.json({ success: true, variables })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
    }
  }

  if (action === 'approve_all') {
    // Approves every unapproved draft of the given confidence levels (default: high only)
    const levels: string[] = Array.isArray(body.confidence) ? body.confidence.map(String) : ['high']
    const { data: rows, error } = await supabaseAdmin
      .from('email_recipients')
      .select('id, variables')
      .eq('campaign_id', id)
      .eq('status', 'pending')
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const todo = ((rows || []) as Pick<RecipientRow, 'id' | 'variables'>[]).filter(r => {
      const v = r.variables || {}
      return !v.opener_approved && typeof v.opener_draft === 'string' && v.opener_draft && levels.includes(String(v.opener_confidence))
    })
    let approved = 0
    for (const r of todo) {
      await mergeVariables(r.id, { opener_approved: true, opener: String(r.variables!.opener_draft) })
      approved++
    }
    return NextResponse.json({ approved })
  }

  if (action !== 'generate') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  if (!isAiEnabled()) {
    return NextResponse.json({ error: 'AI_DISABLED' }, { status: 400 })
  }
  const limited = rateLimit(user.id, 'personalize')
  if (limited) return limited

  const overwrite = Boolean(body.overwrite)
  let query = supabaseAdmin
    .from('email_recipients')
    .select('id, email, name, company, status, variables')
    .eq('campaign_id', id)
    .order('created_at', { ascending: true })

  const recipientIds: string[] | undefined = Array.isArray(body.recipientIds) ? body.recipientIds.map(String) : undefined
  query = recipientIds?.length ? query.in('id', recipientIds) : query.eq('status', 'pending')

  const { data: rows, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // opener_confidence is set on every attempt (including failures), so finished rows aren't redone
  const todo = ((rows || []) as RecipientRow[]).filter(r => overwrite || !r.variables?.opener_confidence)
  const deadline = Date.now() + TIME_BUDGET_MS
  const results: Array<{ id: string; opener: string; confidence: string }> = []
  const errors: string[] = []
  let cursor = 0

  async function worker() {
    while (cursor < todo.length && Date.now() < deadline) {
      const r = todo[cursor++]
      const vars = r.variables || {}
      try {
        const out = await generateOpener({
          name: r.name,
          title: typeof vars.title === 'string' ? vars.title : null,
          company: r.company,
          domain: companyDomainFromEmail(r.email) || (typeof vars.domain === 'string' ? vars.domain : null),
          jobTitle: typeof vars.job_title === 'string' ? vars.job_title : null,
        })
        await mergeVariables(r.id, {
          opener_draft: out.opener,
          opener_basis: out.basis,
          opener_confidence: out.confidence,
          opener_approved: false,
          opener: '',
        })
        results.push({ id: r.id, opener: out.opener, confidence: out.confidence })
      } catch (err) {
        if (err instanceof AiDisabledError) throw err
        errors.push(`${r.email}: ${err instanceof Error ? err.message : 'failed'}`)
        // Mark as attempted so the loop doesn't retry the same failing recipient forever
        await mergeVariables(r.id, { opener_draft: '', opener: '', opener_confidence: 'failed', opener_approved: false }).catch(() => {})
        results.push({ id: r.id, opener: '', confidence: 'failed' })
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  } catch (err) {
    if (err instanceof AiDisabledError) {
      return NextResponse.json({ error: 'AI_DISABLED' }, { status: 400 })
    }
    throw err
  }

  return NextResponse.json({
    done: results.length,
    remaining: todo.length - results.length,
    results,
    errors: errors.length ? errors : undefined,
  })
}
