import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUser } from '@/lib/auth/actions'
import { upsertApplication } from '@/lib/pipeline'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const PROVIDERS = ['greenhouse', 'lever', 'ashby']
const STATUSES = ['saved', 'applied', 'dismissed']

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { job?: Record<string, unknown>; domain?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const job = body.job || {}
  const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const provider = text(job.provider, 20)
  const jobId = text(job.id, 200)
  const title = text(job.title, 300)
  const domain = text(body.domain ?? job.domain, 253).toLowerCase()
  const url = text(job.url, 2000)
  if (!PROVIDERS.includes(provider) || !jobId || !title || !domain) {
    return NextResponse.json({ error: 'job.provider, job.id, job.title and domain are required' }, { status: 400 })
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'Invalid job URL' }, { status: 400 })
  }
  const status = STATUSES.includes(String(body.status)) ? String(body.status) : 'saved'
  const company = text(job.company, 200) || domain

  const { data: saved, error } = await supabaseAdmin
    .from('saved_jobs')
    .upsert(
      {
        user_id: user.id,
        company,
        domain,
        provider,
        board_token: text(job.boardToken, 200),
        job_id: jobId,
        title,
        url: url || null,
        location: text(job.location, 300) || null,
        score: typeof job.score === 'number' ? Math.round(job.score) : null,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider,job_id' }
    )
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The pipeline board is a nice-to-have; a failure there shouldn't lose the saved job
  let applicationId: string | null = null
  let pipelineError: string | undefined
  if (status !== 'dismissed') {
    try {
      const application = await upsertApplication(user.id, {
        company,
        domain,
        jobTitle: title,
        jobUrl: url || undefined,
        stage: 'target',
        source: `jobs:${provider}`,
      })
      applicationId = application.id
    } catch (err) {
      pipelineError = err instanceof Error ? err.message : 'Failed to add to pipeline'
    }
  }

  return NextResponse.json({ success: true, savedJobId: saved?.id, applicationId, pipelineError })
}

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabaseAdmin
    .from('saved_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data || [])
}
