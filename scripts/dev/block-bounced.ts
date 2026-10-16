/**
 * Reads bounce notices (mailer-daemon) in the inbox and adds every hard-bounced
 * address to blocked_emails, so campaigns never email them again.
 *
 *   npx tsx --env-file=.env.local scripts/dev/block-bounced.ts
 */
import { createClient } from '@supabase/supabase-js'
import { getGmailForUser, mapWithConcurrency } from '../../lib/gmail/cleanup'
import { extractMessageText } from '../../lib/email/bounces'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data } = await admin.from('gmail_credentials').select('user_id')
  const ctx = await getGmailForUser(data![0].user_id)
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res: any = await ctx.gmail.users.messages.list({ userId: 'me', q: 'from:(mailer-daemon OR postmaster)', maxResults: 500, pageToken })
    ids.push(...(res.data.messages || []).map((m: any) => m.id))
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  const found = new Map<string, string>()
  await mapWithConcurrency(ids, 4, Date.now() + 20 * 60_000, async (id: string) => {
    const msg: any = await ctx.gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const headers: any[] = msg.data.payload?.headers || []
    const failed = headers.find((h) => h.name?.toLowerCase() === 'x-failed-recipients')?.value || ''
    const text = extractMessageText(msg.data.payload) || ''
    // Only permanent failures (5.x.x); temporary 4.x.x delays are not real bounces
    const permanent = /\b5\.\d\.\d+\b|\b55\d\b|address not found|does not exist|user unknown|no such user/i.test(text)
    if (!permanent) return
    const addrs = failed
      ? failed.split(/[,\s]+/)
      : [...text.matchAll(/Final-Recipient:\s*rfc822;\s*([^\s>]+)/gi)].map((m) => m[1])
    for (const a of addrs) {
      const email = a.trim().toLowerCase().replace(/^<|>$/g, '')
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) found.set(email, 'bounced')
    }
  })

  const rows = [...found.keys()].map((email) => ({ email, reason: 'bounced', blocked_at: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('blocked_emails').upsert(rows.slice(i, i + 200), { onConflict: 'email' })
    if (error) throw error
  }
  console.log(`Bounce notices read: ${ids.length}; hard-bounced addresses blocked: ${rows.length}`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
