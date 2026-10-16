import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  getSenderSettings,
  updateSenderSettings,
  getSendBudget,
  isWithinSendWindow,
  SenderSettings,
} from '@/lib/email/deliverability'

async function buildResponse(settings: SenderSettings) {
  const budget = await getSendBudget(settings.user_id, settings)
  const { user_id, ...rest } = settings
  return { settings: rest, budget, window: isWithinSendWindow(settings) }
}

export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const settings = await getSenderSettings(user.id)
    return NextResponse.json(await buildResponse(settings))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    // next_send_at is managed by the sender, never by the client
    const { next_send_at, user_id, ...patch } = body || {}
    const settings = await updateSenderSettings(user.id, patch)
    return NextResponse.json(await buildResponse(settings))
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
