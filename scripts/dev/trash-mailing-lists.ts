/**
 * Moves old mailing-list mail (messages with a List-Unsubscribe header) from
 * the inbox to Trash, skipping job-application systems, academic mail and
 * account-security senders, plus everything the cleanup safety query protects.
 * Trashed ids are written to a log so `--restore <log>` brings back exactly them.
 *
 *   npx tsx --env-file=.env.local scripts/dev/trash-mailing-lists.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/dev/trash-mailing-lists.ts --yes
 *   npx tsx --env-file=.env.local scripts/dev/trash-mailing-lists.ts --restore scripts/dev/.trash-log-<ts>.json
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { buildSafeQuery, getGmailForUser, getProtectedEmails, mapWithConcurrency, parseFromHeader } from '../../lib/gmail/cleanup'

const MIN_AGE_DAYS = 7

// Never trash these even if they look like mailing lists
const KEEP_SENDER = [
  /myworkday(jobs)?\.com$/, /workday\.com$/, /oracle\.com$/, /oraclecloud\.com$/, /workablemail\.com$/, /workable\.com$/,
  /greenhouse(-mail)?\.io$/, /lever\.co$/, /ashbyhq\.com$/, /smartrecruiters\.com$/, /jobs2web\.com$/, /icims\.com$/,
  /successfactors\.(com|eu)$/, /taleo\.net$/, /hackerrank\.com$/, /codility\.com$/, /hirevue\.com$/,
  /\.ac\.in$/, /\.edu$/, /\.edu\.[a-z]{2}$/, /\.gov(\.[a-z]{2})?$/,
]
const KEEP_EXACT = new Set(['noreply-accounts@google.com', 'no-reply@accounts.google.com', 'mailer-daemon@googlemail.com'])

function keepSender(email: string): boolean {
  const domain = email.split('@')[1] || ''
  return KEEP_EXACT.has(email) || KEEP_SENDER.some((re) => re.test(domain))
}

/** Retries Gmail calls on rate limits / quota errors with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.code || err?.response?.status
      const quota = /quota|rate limit/i.test(err?.message || '')
      if (attempt < 8 && (status === 429 || status >= 500 || (status === 403 && quota))) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt) + Math.random() * 1000))
        continue
      }
      throw err
    }
  }
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function listIds(gmail: any, q: string): Promise<string[]> {
  const out: string[] = []
  let pageToken: string | undefined
  do {
    const res: any = await withRetry(() => gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken }))
    out.push(...(res.data.messages || []).map((m: any) => m.id))
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const { data } = await admin.from('gmail_credentials').select('user_id')
  if (!data?.length) throw new Error('No Gmail account connected')
  const userId = process.env.CLEANUP_USER_ID || data[0].user_id
  const ctx = await getGmailForUser(userId)

  const restoreIdx = args.indexOf('--restore')
  if (restoreIdx >= 0) {
    const ids: string[] = JSON.parse(fs.readFileSync(args[restoreIdx + 1], 'utf8')).ids
    for (let i = 0; i < ids.length; i += 1000) {
      await withRetry(() => ctx.gmail.users.messages.batchModify({ userId: 'me', requestBody: { ids: ids.slice(i, i + 1000), removeLabelIds: ['TRASH'] } }))
    }
    console.log(`Restored ${ids.length} messages`)
    return
  }

  const protectedEmails = await getProtectedEmails(userId, ctx.email)
  const q = buildSafeQuery(`in:inbox older_than:${MIN_AGE_DAYS}d`, protectedEmails)
  const candidates = await listIds(ctx.gmail, q)
  console.log(`Inbox messages older than ${MIN_AGE_DAYS} days (after safety rules): ${candidates.length}`)

  // Header scan results are cached so re-runs only read new messages (Gmail quota is per minute)
  const cachePath = path.join(__dirname, '.scan-cache.json')
  const cache: Record<string, { from: string; isList: boolean }> = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {}
  const todo = candidates.filter((id) => !cache[id])
  console.log(`Already scanned: ${candidates.length - todo.length}, to scan: ${todo.length}`)
  let failed = 0
  let done = 0
  const { truncated } = await mapWithConcurrency(todo, 5, Date.now() + 45 * 60_000, async (id: string) => {
    try {
      const msg: any = await withRetry(() => ctx.gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'List-Unsubscribe'] }))
      const headers: any[] = msg.data.payload?.headers || []
      cache[id] = {
        from: parseFromHeader(headers.find((h) => h.name === 'From')?.value || '').email,
        isList: headers.some((h) => h.name?.toLowerCase() === 'list-unsubscribe'),
      }
    } catch (err) {
      failed++
      throw err
    }
    if (++done % 250 === 0) {
      fs.writeFileSync(cachePath, JSON.stringify(cache))
      console.log(`  scanned ${done}/${todo.length}`)
    }
  })
  fs.writeFileSync(cachePath, JSON.stringify(cache))
  const results = candidates.filter((id) => cache[id]).map((id) => ({ id, ...cache[id] }))
  console.log(`Scanned ${results.length}/${candidates.length} messages${failed ? ` (${failed} failed)` : ''}`)
  if (truncated) console.log('Warning: metadata scan hit its time limit; re-run to catch the rest')

  const trash = results.filter((r) => r.isList && r.from && !keepSender(r.from))
  const kept = results.filter((r) => r.isList && keepSender(r.from))
  const bySender = new Map<string, number>()
  for (const r of trash) bySender.set(r.from, (bySender.get(r.from) || 0) + 1)

  console.log(`Mailing-list mail to trash: ${trash.length} from ${bySender.size} senders (kept ${kept.length} job/academic/security list mails)`)
  for (const [s, n] of [...bySender].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${String(n).padStart(6)}  ${s}`)

  if (!args.includes('--yes')) {
    console.log('\nDry run — add --yes to move these to Trash')
    return
  }

  const ids = trash.map((r) => r.id)
  const logPath = path.join(__dirname, `.trash-log-${Date.now()}.json`)
  fs.writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ids, senders: Object.fromEntries(bySender) }))
  for (let i = 0; i < ids.length; i += 1000) {
    await withRetry(() => ctx.gmail.users.messages.batchModify({ userId: 'me', requestBody: { ids: ids.slice(i, i + 1000), addLabelIds: ['TRASH'] } }))
    process.stdout.write(`  ${Math.min(i + 1000, ids.length)}/${ids.length}\r`)
  }
  console.log(`\nMoved ${ids.length} messages to Trash. Undo log: ${path.relative(process.cwd(), logPath)}`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
