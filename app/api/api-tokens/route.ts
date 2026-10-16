import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { createApiToken, deleteApiToken, listApiTokens } from '@/lib/api-token'

// Not on the API-token allowlist: tokens can only be managed from a logged-in browser session

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await listApiTokens(user.id))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** Creates a token. The plain token is returned only in this response. */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name } = await request.json().catch(() => ({}))
  try {
    return NextResponse.json(await createApiToken(user.id, String(name || 'MCP server')))
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    await deleteApiToken(user.id, id)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
