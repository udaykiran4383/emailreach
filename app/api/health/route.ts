import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { runHealthChecks } from '@/lib/health'

export const dynamic = 'force-dynamic'

/** GET /api/health → setup checklist for the signed-in user. */
export async function GET() {
  const user = await getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await runHealthChecks(user.id)
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
}
