import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  listApplications,
  upsertApplication,
  syncFromCampaigns,
  normalizeDomain,
  companyFromDomain,
  isStage,
} from '@/lib/pipeline'

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await listApplications(user.id))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))

  try {
    if (body.action === 'sync') {
      const result = await syncFromCampaigns(user.id)
      return NextResponse.json({ success: true, ...result })
    }

    const domain = normalizeDomain(String(body.domain || body.url || ''))
    if (!domain || !domain.includes('.')) {
      return NextResponse.json({ error: 'A company domain or website is required' }, { status: 400 })
    }
    if (body.stage !== undefined && !isStage(body.stage)) {
      return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
    }

    const { id } = await upsertApplication(user.id, {
      company: String(body.company || '').trim() || companyFromDomain(domain),
      domain,
      jobTitle: body.jobTitle ? String(body.jobTitle) : undefined,
      jobUrl: body.jobUrl ? String(body.jobUrl) : undefined,
      stage: body.stage,
      source: body.source ? String(body.source) : 'manual',
    })
    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
