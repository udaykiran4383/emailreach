import { createClient } from '@supabase/supabase-js'
import { buildSafeQuery, getGmailForUser, getProtectedEmails, mapWithConcurrency, parseFromHeader } from '../../lib/gmail/cleanup'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function ids(gmail: any, q: string, cap: number) { const out: string[] = []; let pageToken; do { const r: any = await gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken }); out.push(...(r.data.messages || []).map((m: any) => m.id)); pageToken = r.data.nextPageToken } while (pageToken && out.length < cap); return out }
;(async () => {
  const { data } = await admin.from('gmail_credentials').select('user_id').limit(1)
  const userId = data![0].user_id
  const ctx = await getGmailForUser(userId)
  const prot = await getProtectedEmails(userId, ctx.email)
  const safe = (q: string) => buildSafeQuery(q, prot)
  for (const q of ['in:inbox unsubscribe', 'in:inbox -unsubscribe']) console.log(q.padEnd(24), (await ids(ctx.gmail, safe(q), 20000)).length)
  const all = await ids(ctx.gmail, safe('in:inbox'), 2500)
  const { results } = await mapWithConcurrency(all, 25, Date.now() + 240000, async (id: string) => {
    const m: any = await ctx.gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'List-Unsubscribe'] })
    const h = m.data.payload?.headers || []
    return { from: parseFromHeader(h.find((x: any) => x.name === 'From')?.value || '').email, list: h.some((x: any) => x.name === 'List-Unsubscribe'), unread: (m.data.labelIds || []).includes('UNREAD') }
  })
  const agg = new Map<string, { n: number; list: number; unread: number }>()
  for (const r of results as any[]) { const a = agg.get(r.from) || { n: 0, list: 0, unread: 0 }; a.n++; if (r.list) a.list++; if (r.unread) a.unread++; agg.set(r.from, a) }
  const listMail = (results as any[]).filter(r => r.list).length
  console.log(`\nsample: newest ${results.length} inbox emails — ${listMail} from mailing lists (have List-Unsubscribe)`)
  console.log('count  list  unread  sender')
  for (const [e, a] of [...agg].sort((x, y) => y[1].n - x[1].n).slice(0, 40)) console.log(String(a.n).padStart(5), String(a.list).padStart(5), String(a.unread).padStart(7), ' ', e)
})().catch(e => { console.error(e.message); process.exit(1) })
