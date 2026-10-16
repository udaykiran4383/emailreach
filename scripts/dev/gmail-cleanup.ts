/**
 * Command-line Inbox Cleanup for the connected Gmail account, with the same
 * safety rules as the dashboard page (starred, important, sent, drafts, chats
 * and campaign contacts who replied are never touched). Only moves mail to
 * Trash — Gmail deletes it after 30 days; `restore` brings it back.
 *
 *   npx tsx --env-file=.env.local scripts/dev/gmail-cleanup.ts scan
 *   npx tsx --env-file=.env.local scripts/dev/gmail-cleanup.ts senders promotions
 *   npx tsx --env-file=.env.local scripts/dev/gmail-cleanup.ts trash promotions social --yes
 *   npx tsx --env-file=.env.local scripts/dev/gmail-cleanup.ts restore promotions --yes
 */
import { createClient } from '@supabase/supabase-js'
import {
  CLEANUP_PRESETS,
  buildUserQuery,
  getGmailForUser,
  hasModifyScope,
  mapWithConcurrency,
  modifyMatching,
  parseFromHeader,
} from '../../lib/gmail/cleanup'

/** Retries Gmail calls when the per-minute quota is hit (other jobs may share it). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.code || err?.response?.status
      if (attempt < 8 && (status === 429 || status >= 500 || (status === 403 && /quota|rate/i.test(err?.message || '')))) {
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt) + Math.random() * 1000))
        continue
      }
      throw err
    }
  }
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function getUserId(): Promise<string> {
  const { data, error } = await admin.from('gmail_credentials').select('user_id, email_address')
  if (error) throw error
  if (!data?.length) throw new Error('No Gmail account connected yet')
  if (data.length > 1 && !process.env.CLEANUP_USER_ID) {
    throw new Error('Several Gmail accounts connected — set CLEANUP_USER_ID')
  }
  return process.env.CLEANUP_USER_ID || data[0].user_id
}

/** Exact count by paging message ids (Gmail's resultSizeEstimate is often far off). */
async function countMatching(gmail: any, q: string, cap = 50000): Promise<number> {
  let count = 0
  let pageToken: string | undefined
  do {
    const res: any = await withRetry(() => gmail.users.messages.list({ userId: 'me', q, maxResults: 500, pageToken }))
    count += res.data.messages?.length || 0
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken && count < cap)
  return count
}

// Never touch job-application systems, academic/government mail, account security, or job-process subjects
const KEEP_QUERY = [
  '-from:(ac.in OR edu OR gov.in OR myworkday OR myworkdayjobs OR workday OR greenhouse OR lever.co OR ashbyhq OR smartrecruiters OR jobs2web OR icims OR workablemail OR oraclecloud OR taleo OR successfactors OR hackerrank OR codility OR hirevue OR accounts.google.com)',
  '-subject:(interview OR offer OR application OR shortlisted OR assessment OR onboarding OR "offer letter")',
].join(' ')

async function main() {
  const [command = 'scan', ...rest] = process.argv.slice(2)
  const confirmed = rest.includes('--yes')
  const presetIds = rest.filter((a) => !a.startsWith('--'))

  const userId = await getUserId()
  const ctx = await getGmailForUser(userId)
  if (!(await hasModifyScope(ctx))) throw new Error('Gmail is connected without the gmail.modify permission — reconnect in Settings')

  const profile: any = await withRetry(() => ctx.gmail.users.getProfile({ userId: 'me' }))
  console.log(`Mailbox ${ctx.email}: ${profile.data.messagesTotal} messages, ${profile.data.threadsTotal} threads`)

  if (command === 'scan') {
    const inbox = await countMatching(ctx.gmail, 'in:inbox')
    console.log(`In inbox: ${inbox}\n`)
    for (const preset of CLEANUP_PRESETS) {
      const q = await buildUserQuery(ctx, userId, { presetId: preset.id })
      console.log(`${preset.id.padEnd(12)} ${String(await countMatching(ctx.gmail, q)).padStart(6)}  ${preset.label} — ${preset.description}`)
    }
    return
  }

  if (command === 'senders') {
    const presetId = presetIds[0] || 'promotions'
    const q = await buildUserQuery(ctx, userId, { presetId })
    const list = await ctx.gmail.users.messages.list({ userId: 'me', q, maxResults: 500 })
    const ids = (list.data.messages || []).map((m) => m.id!)
    const { results: froms } = await mapWithConcurrency(ids, 20, Date.now() + 120000, async (id: string) => {
      const msg = await ctx.gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From'] })
      return parseFromHeader(msg.data.payload?.headers?.find((h) => h.name === 'From')?.value || '').email
    })
    const counts = new Map<string, number>()
    for (const email of froms) if (email) counts.set(email, (counts.get(email) || 0) + 1)
    console.log(`Top senders in ${presetId} (sample of ${ids.length}):`)
    for (const [email, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(5)}  ${email}`)
    return
  }

  // Custom Gmail search, e.g. trash-query 'from:(hirist.tech OR naukri.com)' --yes
  if (command === 'trash-query' || command === 'restore-query') {
    const custom = presetIds.join(' ').trim()
    if (!custom) throw new Error('Give a Gmail search query')
    const restoring = command === 'restore-query'
    const base = await buildUserQuery(ctx, userId, { query: custom })
    const q = restoring ? `in:trash ${base}` : base
    const total = await countMatching(ctx.gmail, q)
    console.log(`${restoring ? 'Restore' : 'Trash'}: ${total} messages\n  query: ${q}`)
    if (!confirmed) return console.log('  (dry run — add --yes to apply)')
    let done = 0
    for (;;) {
      const result = await withRetry(() => modifyMatching(
        ctx.gmail,
        q,
        restoring ? { addLabelIds: [], removeLabelIds: ['TRASH'] } : { addLabelIds: ['TRASH'], removeLabelIds: [] },
        { timeBudgetMs: 60000, includeSpamTrash: restoring }
      ))
      done += result.modified
      if (!result.remaining) break
    }
    console.log(`  ${restoring ? 'restored' : 'moved to Trash'}: ${done}`)
    return
  }

  if (command === 'trash' || command === 'restore') {
    if (presetIds.length === 0) throw new Error('Name at least one preset, e.g. promotions')
    const restoring = command === 'restore'
    for (const presetId of presetIds) {
      const base = await buildUserQuery(ctx, userId, { presetId, query: KEEP_QUERY })
      const q = restoring ? `in:trash ${base}` : base
      const total = await countMatching(ctx.gmail, q)
      console.log(`${restoring ? 'Restore' : 'Trash'} ${presetId}: ${total} messages\n  query: ${q}`)
      if (!confirmed) {
        console.log('  (dry run — add --yes to apply)')
        continue
      }
      let done = 0
      for (;;) {
        const result = await withRetry(() => modifyMatching(
          ctx.gmail,
          q,
          restoring ? { addLabelIds: [], removeLabelIds: ['TRASH'] } : { addLabelIds: ['TRASH'], removeLabelIds: [] },
          { timeBudgetMs: 60000, includeSpamTrash: restoring }
        ))
        done += result.modified
        process.stdout.write(`  ${done}/${total}\r`)
        if (!result.remaining) break
      }
      console.log(`  ${restoring ? 'restored' : 'moved to Trash'}: ${done}`)
    }
    return
  }

  throw new Error(`Unknown command "${command}" — use scan, senders, trash or restore`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
