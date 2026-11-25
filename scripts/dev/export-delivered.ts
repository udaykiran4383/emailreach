/**
 * Exports every email that was delivered (sent or replied, never bounced or failed),
 * one row per recipient, plus a one-row-per-company summary.
 *
 *   npx tsx --env-file=.env.local scripts/dev/export-delivered.ts
 *
 * Output: data/delivered_emails.csv and data/delivered_companies.csv
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const cell = (v: unknown) => {
  const x = String(v ?? '')
  return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x
}
const ist = (t: string | null) => (t ? new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }) : '')

async function main() {
  const { data: campaigns, error } = await s.from('campaigns').select('id,name')
  if (error) throw error
  const campaignName = new Map((campaigns || []).map((c) => [c.id, c.name]))

  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await s
      .from('email_recipients')
      .select('email,name,company,role,variables,status,sent_at,replied_at,reply_snippet,error_message,bounced_at,campaign_id')
      .in('status', ['sent', 'replied'])
      .is('bounced_at', null)
      .order('sent_at', { ascending: true })
      .range(from, from + 999)
    if (e) throw e
    rows.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  // Delivered without errors, and each address only once (earliest send)
  const seen = new Set<string>()
  const ok = rows.filter((r) => r.sent_at && !r.error_message && !seen.has(r.email.toLowerCase()) && seen.add(r.email.toLowerCase()))

  const cols = ['company', 'domain', 'name', 'title', 'email', 'status', 'sent_at_ist', 'replied_at_ist', 'reply_snippet', 'campaign']
  const out = ok.map((r) => ({
    company: r.company || '',
    domain: r.email.split('@')[1],
    name: r.name === 'there' ? '' : r.name || '',
    title: r.variables?.title || r.role || '',
    email: r.email,
    status: r.status,
    sent_at_ist: ist(r.sent_at),
    replied_at_ist: ist(r.replied_at),
    reply_snippet: (r.reply_snippet || '').replace(/\s+/g, ' ').slice(0, 200),
    campaign: campaignName.get(r.campaign_id) || '',
  }))
  out.sort((a, b) => a.company.localeCompare(b.company) || a.email.localeCompare(b.email))
  fs.writeFileSync('data/delivered_emails.csv', [cols.join(','), ...out.map((r: any) => cols.map((k) => cell(r[k])).join(','))].join('\n') + '\n')

  const byDomain = new Map<string, any[]>()
  for (const r of out) byDomain.set(r.domain, [...(byDomain.get(r.domain) || []), r])
  const ccols = ['company', 'domain', 'emails_delivered', 'contacts', 'replied', 'first_sent_ist', 'last_sent_ist']
  const comp = [...byDomain.entries()].map(([domain, xs]) => ({
    company: xs.find((x) => x.company)?.company || domain,
    domain,
    emails_delivered: xs.length,
    contacts: xs.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join('; '),
    replied: xs.some((x) => x.status === 'replied') ? 'yes' : 'no',
    first_sent_ist: xs.map((x) => x.sent_at_ist).sort()[0],
    last_sent_ist: xs.map((x) => x.sent_at_ist).sort().pop(),
  }))
  comp.sort((a, b) => a.company.localeCompare(b.company))
  fs.writeFileSync('data/delivered_companies.csv', [ccols.join(','), ...comp.map((r: any) => ccols.map((k) => cell(r[k])).join(','))].join('\n') + '\n')

  console.log(`${out.length} delivered emails (${out.filter((r) => r.status === 'replied').length} replied) at ${comp.length} companies`)
  console.log('-> data/delivered_emails.csv, data/delivered_companies.csv')
}

main().catch((e) => {
  console.error(e?.message || e)
  process.exit(1)
})
