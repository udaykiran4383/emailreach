import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { buildUserQuery, cleanupErrorBody, getGmailForUser, modifyMatching } from '@/lib/gmail/cleanup'

const SENDER_CHUNK = 50

/**
 * Moves matching mail to Trash (recoverable for 30 days). Time-boxed: the
 * client calls again while `remaining` is true.
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { presetId, query, senders, age } = await request.json().catch(() => ({}))
  const senderList: string[] = Array.isArray(senders) ? senders : []

  try {
    const ctx = await getGmailForUser(user.id)
    const deadline = Date.now() + 8000

    // Long sender lists are split so each Gmail query stays reasonably short
    const senderChunks = senderList.length > 0
      ? Array.from({ length: Math.ceil(senderList.length / SENDER_CHUNK) }, (_, i) => senderList.slice(i * SENDER_CHUNK, (i + 1) * SENDER_CHUNK))
      : [undefined]

    let trashed = 0
    let remaining = false
    const queries: string[] = []

    for (const chunk of senderChunks) {
      const q = await buildUserQuery(ctx, user.id, { presetId, query, senders: chunk, age })
      queries.push(q)
      const timeLeft = deadline - Date.now()
      if (timeLeft <= 500) {
        remaining = true
        continue
      }
      const result = await modifyMatching(
        ctx.gmail,
        q,
        { addLabelIds: ['TRASH'], removeLabelIds: [] },
        { timeBudgetMs: timeLeft }
      )
      trashed += result.modified
      remaining ||= result.remaining
    }

    console.log(`[cleanup] user=${user.id} trashed=${trashed} remaining=${remaining} queries=${queries.length}`)

    return NextResponse.json({ trashed, remaining, query: queries.join('\n'), queries })
  } catch (err: any) {
    const { status, body } = cleanupErrorBody(err)
    return NextResponse.json(body, { status })
  }
}
