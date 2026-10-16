/**
 * Creates the "AI roles" outreach campaigns from data/contacts_ready.csv:
 *   A — founders / CEOs / CTOs / leaders (and anyone without a recruiting title)
 *   B — recruiting inboxes and HR
 * Uploads the resume, adds your own address as the first recipient of A (so the
 * first email lands in your inbox), and leaves both campaigns in the given status.
 *
 *   npx tsx --env-file=.env.local scripts/dev/launch-campaign.ts [--status draft|scheduled]
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const RESUME = 'data/Udaykiran_Yennampelly_Resume.pdf'
// Personal sign-off (phone etc.) lives in the gitignored data/signature.txt
const SIGNATURE = fs.existsSync(path.join('data', 'signature.txt'))
  ? fs.readFileSync(path.join('data', 'signature.txt'), 'utf8').trim()
  : 'Best regards,\nYour Name'

const BODY = `Hi {{first_name}},

I'm Udaykiran, an Applied AI Engineer at SMB Catalyst and a 2026 graduate of IIT Bombay. I'm reaching out to ask whether your team has any openings for Applied AI or Backend Engineers.

At SMB Catalyst, I've worked on:

- An AI meeting assistant that transcribes calls and writes summaries
- Image search that matches product photos to a large catalogue
- A recommendation system for sales orders
- LLM tools that read and organise supplier catalogues

My resume is attached. Would you be open to a short conversation if there's a fit?

${SIGNATURE}`

const TEMPLATES = {
  leaders: { name: 'AI roles — founders & leaders', subject: 'Applied AI Engineer – Udaykiran Yennampelly', body: BODY },
  hr: { name: 'AI roles — recruiting & HR', subject: 'Applied AI Engineer – Udaykiran Yennampelly', body: BODY },
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header, ...data] = rows
  return data.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const isRecruiting = (title: string) => /\b(hr|human resources|talent|recruit\w*|people|hiring|acquisition)\b/i.test(title)

async function main() {
  const args = process.argv.slice(2)
  const status = args.includes('--status') ? args[args.indexOf('--status') + 1] : 'draft'
  if (!['draft', 'scheduled'].includes(status)) throw new Error('--status must be draft or scheduled')

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: creds } = await admin.from('gmail_credentials').select('user_id, email_address')
  if (!creds?.length) throw new Error('No Gmail account connected')
  const { user_id: userId, email_address: ownEmail } = creds[0]

  // Resume → storage (same bucket/path style as the upload route)
  const storagePath = `${userId}/${path.basename(RESUME)}`
  const { error: upErr } = await admin.storage.from('resumes').upload(storagePath, fs.readFileSync(RESUME), {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (upErr) throw upErr

  const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : 'data/contacts_ready.csv'
  const nameSuffix = args.includes('--name') ? args[args.indexOf('--name') + 1] : ''
  const contacts = parseCsv(fs.readFileSync(csvPath, 'utf8'))
  // Skip anyone already in another campaign so nobody gets the same email twice
  const { data: existing } = await admin.from('email_recipients').select('email, campaigns!inner(user_id)').eq('campaigns.user_id', userId)
  const already = new Set((existing || []).map((r: any) => r.email.toLowerCase()))
  const { data: blocked } = await admin.from('blocked_emails').select('email')
  const blockedSet = new Set((blocked || []).map((b) => b.email.toLowerCase()))

  const groups = { leaders: [] as Record<string, string>[], hr: [] as Record<string, string>[] }
  const seen = new Set<string>()
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase()
    if (!email || seen.has(email) || blockedSet.has(email) || already.has(email) || email === ownEmail.toLowerCase()) continue
    seen.add(email)
    const inbox = c.title === 'Recruiting inbox'
    groups[inbox || isRecruiting(c.title) ? 'hr' : 'leaders'].push({ ...c, email, inbox: inbox ? '1' : '' })
  }

  for (const key of ['leaders', 'hr'] as const) {
    if (groups[key].length === 0) continue
    const tpl = { ...TEMPLATES[key], name: TEMPLATES[key].name + (nameSuffix ? ` — ${nameSuffix}` : '') }
    const { data: campaign, error } = await admin
      .from('campaigns')
      .insert({
        user_id: userId,
        name: tpl.name,
        subject_template: tpl.subject,
        email_body_template: tpl.body,
        resume_storage_path: storagePath,
        attach_resume: true,
        track_opens: false,
        status,
      })
      .select('id')
      .single()
    if (error) throw error

    const now = Date.now()
    const rows = [
      // Your own copy goes first (oldest created_at) so you see the real email before anyone else
      ...(key === 'leaders' && !nameSuffix ? [{ email: ownEmail, name: 'Udaykiran Yennampelly', first_name: '', company: 'SMB Catalyst', title: 'Preview copy', inbox: '' } as Record<string, string>] : []),
      ...groups[key],
    ].map((c, i) => ({
      campaign_id: campaign.id,
      email: c.email,
      // Shared inboxes have no person's name: "Hi there,"
      name: c.inbox ? 'there' : c.name || c.first_name || 'there',
      company: c.company || null,
      variables: { title: c.title || '' },
      status: 'pending',
      verification_status: 'safe',
      verification_reason: 'Verified (MX) when building data/contacts_ready.csv',
      verified_at: new Date().toISOString(),
      created_at: new Date(now + i).toISOString(),
    }))

    for (let i = 0; i < rows.length; i += 200) {
      const { error: insErr } = await admin.from('email_recipients').insert(rows.slice(i, i + 200))
      if (insErr) throw insErr
    }
    await admin.from('campaigns').update({ total_recipients: rows.length }).eq('id', campaign.id)
    console.log(`${tpl.name}: ${rows.length} recipients (${status}) — /dashboard/campaigns/${campaign.id}`)
  }
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
