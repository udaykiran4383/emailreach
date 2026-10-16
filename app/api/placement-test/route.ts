import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  runPlacementTest,
  getPlacementTests,
  recordPlacement,
  summarizePlacement,
  PlacementTest,
} from '@/lib/email/placement'

export const maxDuration = 60

const INSTRUCTIONS =
  "We can't read your other inboxes. Open each test inbox, find the email (check Primary, Promotions and Spam) and record where it landed."

function withSummary(test: PlacementTest) {
  return { ...test, summary: summarizePlacement(test.seeds || []) }
}

/** GET ?campaignId= → recent tests for the campaign. GET ?id= is served from the same list. */
export async function GET(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const campaignId = url.searchParams.get('campaignId')
  const id = url.searchParams.get('id')
  if (!campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })

  const tests = (await getPlacementTests(user.id, campaignId)).map(withSummary)
  if (id) {
    const test = tests.find(t => t.id === id)
    if (!test) return NextResponse.json({ error: 'Placement test not found' }, { status: 404 })
    return NextResponse.json({ instructions: INSTRUCTIONS, test })
  }
  return NextResponse.json({ instructions: INSTRUCTIONS, tests })
}

/** POST { campaignId, seedEmails } → sends the test and returns it. */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!body?.campaignId) return NextResponse.json({ error: 'campaignId is required' }, { status: 400 })

  try {
    const test = await runPlacementTest(user.id, body.campaignId, body.seedEmails)
    return NextResponse.json({ instructions: INSTRUCTIONS, test: withSummary(test) })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

/** PUT { id, placements: { [seedEmail]: 'inbox'|'promotions'|'spam'|'missing'|null } } */
export async function PUT(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!body?.id || typeof body.placements !== 'object') {
    return NextResponse.json({ error: 'id and placements are required' }, { status: 400 })
  }

  try {
    const test = await recordPlacement(user.id, body.id, body.placements)
    return NextResponse.json({ instructions: INSTRUCTIONS, test: withSummary(test) })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
