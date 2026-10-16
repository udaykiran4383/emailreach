import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { cleanupErrorBody, getGmailForUser, modifyMatching } from '@/lib/gmail/cleanup'

/** Undo: moves mail matching the given (already safe) query back from Trash to the inbox. */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { query, queries } = await request.json().catch(() => ({}))
  const list: string[] = (Array.isArray(queries) ? queries : [query])
    .map((q: unknown) => String(q || '').trim())
    .filter(Boolean)

  if (list.length === 0) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 })
  }

  try {
    const ctx = await getGmailForUser(user.id)
    const deadline = Date.now() + 8000
    let restored = 0
    let remaining = false

    for (const q of list) {
      const timeLeft = deadline - Date.now()
      if (timeLeft <= 500) {
        remaining = true
        continue
      }
      const result = await modifyMatching(
        ctx.gmail,
        `in:trash ${q}`,
        { addLabelIds: [], removeLabelIds: ['TRASH'] },
        { includeSpamTrash: true, timeBudgetMs: timeLeft }
      )
      restored += result.modified
      remaining ||= result.remaining
    }

    return NextResponse.json({ restored, remaining })
  } catch (err: any) {
    const { status, body } = cleanupErrorBody(err)
    return NextResponse.json(body, { status })
  }
}
