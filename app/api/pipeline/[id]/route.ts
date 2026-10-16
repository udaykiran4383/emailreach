import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { getApplication, updateApplication, deleteApplication, isStage } from '@/lib/pipeline'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const result = await getApplication(user.id, id)
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))

  if (body.stage !== undefined && !isStage(body.stage)) {
    return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
  }
  if (body.next_step_at && Number.isNaN(Date.parse(body.next_step_at))) {
    return NextResponse.json({ error: 'Invalid next_step_at' }, { status: 400 })
  }
  if ('company' in body && !String(body.company || '').trim()) {
    return NextResponse.json({ error: 'Company cannot be empty' }, { status: 400 })
  }

  // Only editable fields reach the database
  const patch: Parameters<typeof updateApplication>[2] = {}
  if (body.stage !== undefined) patch.stage = body.stage
  if ('notes' in body) patch.notes = body.notes || null
  if ('next_step' in body) patch.next_step = body.next_step || null
  if ('next_step_at' in body) patch.next_step_at = body.next_step_at || null
  if ('company' in body) patch.company = String(body.company).trim()
  if ('job_title' in body) patch.job_title = body.job_title || null

  try {
    const updated = await updateApplication(user.id, id, patch)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  try {
    const deleted = await deleteApplication(user.id, id)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
