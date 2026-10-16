/**
 * Asks each pending recipient's mail server whether the mailbox exists (no email is sent)
 * and marks dead addresses as skipped, so they never bounce and hurt your sender reputation.
 * Domains that won't answer (Microsoft 365, Mimecast, catch-all) are left as they are.
 *
 *   npx tsx --env-file=.env.local scripts/dev/recheck-recipients.ts [--dry-run]
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { checkDomain, probeSession, type DomainCheck } from '../../lib/email/smtp-finder'

const CACHE = path.join('data', '.smtp-cache.json')

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const cache: { domains: Record<string, DomainCheck>; emails: Record<string, string> } =
    fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : { domains: {}, emails: {} }

  const { data: rows, error } = await admin
    .from('email_recipients')
    .select('id, email, campaigns!inner(name, status)')
    .eq('status', 'pending')
    .in('campaigns.status', ['draft', 'scheduled', 'paused'])
  if (error) throw error

  const byDomain = new Map<string, { id: string; email: string; campaign: string }[]>()
  for (const r of rows || []) {
    const d = r.email.split('@')[1].toLowerCase()
    byDomain.set(d, [...(byDomain.get(d) || []), { id: r.id, email: r.email.toLowerCase(), campaign: (r as any).campaigns.name }])
  }
  console.log(`${rows?.length} pending recipients at ${byDomain.size} domains`)

  const dead: { id: string; email: string; campaign: string }[] = []
  let confirmed = 0
  let unverifiable = 0
  const queue = [...byDomain.keys()]
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const d = queue.shift()!
      const list = byDomain.get(d)!
      cache.domains[d] ||= await checkDomain(d)
      const { kind, mx } = cache.domains[d]
      if (kind !== 'probeable') { unverifiable += list.length; continue }
      const todo = list.map((r) => r.email).filter((e) => !cache.emails[e])
      if (todo.length) {
        const { results } = await probeSession(mx!, todo)
        for (const [e, res] of results) if (res.status !== 'unknown') cache.emails[e] = res.status
      }
      for (const r of list) {
        if (cache.emails[r.email] === 'invalid') dead.push(r)
        else if (cache.emails[r.email] === 'safe') confirmed++
        else unverifiable++
      }
    }
  }))
  fs.writeFileSync(CACHE, JSON.stringify(cache))

  console.log(`Mailbox confirmed: ${confirmed}, does not exist: ${dead.length}, server won't say: ${unverifiable}`)
  for (const r of dead) console.log(`  ✗ ${r.email}  (${r.campaign})`)
  if (dryRun || !dead.length) return

  const { error: upErr } = await admin
    .from('email_recipients')
    .update({
      status: 'skipped',
      verification_status: 'invalid',
      verification_reason: 'Mailbox does not exist (mail server check)',
      verified_at: new Date().toISOString(),
      error_message: 'Skipped: mailbox does not exist',
    })
    .in('id', dead.map((r) => r.id))
  if (upErr) throw upErr
  console.log(`Marked ${dead.length} as skipped`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
