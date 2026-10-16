import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import {
  buildUserQuery,
  cleanupErrorBody,
  getGmailForUser,
  mapWithConcurrency,
  parseFromHeader,
} from '@/lib/gmail/cleanup'
import { planUnsubscribe, UnsubscribeMethod } from '@/lib/gmail/unsubscribe'

interface SenderSummary {
  email: string
  name: string
  count: number
  hasListUnsubscribe: boolean
  /** How we'd unsubscribe, judged from their most recent email in the sample */
  unsubscribeMethod: UnsubscribeMethod
  lastDate: string | null
}

/** Groups a sample of matching messages by sender so the user can pick who to clean. */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { presetId, query, age, sample = 500 } = await request.json().catch(() => ({}))
  const sampleSize = Math.min(Math.max(Number(sample) || 500, 1), 1000)
  const deadline = Date.now() + 20000

  try {
    const ctx = await getGmailForUser(user.id)
    const q = await buildUserQuery(ctx, user.id, { presetId, query, age })

    const ids: string[] = []
    let pageToken: string | undefined
    let estimatedTotal = 0
    do {
      const res = await ctx.gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: Math.min(500, sampleSize - ids.length),
        pageToken,
      })
      if (!estimatedTotal) estimatedTotal = res.data.resultSizeEstimate ?? 0
      ids.push(...(res.data.messages || []).map((m) => m.id!).filter(Boolean))
      pageToken = res.data.nextPageToken || undefined
    } while (pageToken && ids.length < sampleSize && Date.now() < deadline)

    const { results, truncated } = await mapWithConcurrency(ids, 20, deadline, async (id) => {
      const msg = await ctx.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'List-Unsubscribe', 'List-Unsubscribe-Post'],
      })
      const headers = msg.data.payload?.headers || []
      const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || ''
      const header = (name: string) => headers.find((h) => h.name?.toLowerCase() === name)?.value || ''
      const listUnsub = !!header('list-unsubscribe')
      const method = planUnsubscribe(header('list-unsubscribe'), header('list-unsubscribe-post')).method
      return { ...parseFromHeader(from), listUnsub, method, date: msg.data.internalDate ? Number(msg.data.internalDate) : 0 }
    })

    const bySender = new Map<string, SenderSummary & { lastTs: number }>()
    for (const r of results) {
      if (!r.email) continue
      const existing = bySender.get(r.email)
      if (existing) {
        existing.count++
        existing.hasListUnsubscribe ||= r.listUnsub
        if (r.date > existing.lastTs) {
          existing.lastTs = r.date
          existing.unsubscribeMethod = r.method
        }
        if (!existing.name && r.name) existing.name = r.name
      } else {
        bySender.set(r.email, { email: r.email, name: r.name, count: 1, hasListUnsubscribe: r.listUnsub, unsubscribeMethod: r.method, lastDate: null, lastTs: r.date })
      }
    }

    const senders: SenderSummary[] = Array.from(bySender.values())
      .sort((a, b) => b.count - a.count)
      .map(({ lastTs, ...s }) => ({ ...s, lastDate: lastTs ? new Date(lastTs).toISOString() : null }))

    return NextResponse.json({
      query: q,
      senders,
      sampled: results.length,
      estimatedTotal,
      truncated: truncated || Date.now() >= deadline,
    })
  } catch (err: any) {
    const { status, body } = cleanupErrorBody(err)
    return NextResponse.json(body, { status })
  }
}
