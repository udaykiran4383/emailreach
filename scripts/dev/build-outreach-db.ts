/**
 * Builds data/outreach.db (SQLite): every researched company, every contact found for it, and
 * every email sent with its outcome, so you can query who was reached and who is still open.
 *
 *   npx tsx --env-file=.env.local scripts/dev/build-outreach-db.ts
 *
 * Tables
 *   companies  domain, company, city, what_they_do, funding, founders, public_email, source_file, source_url
 *   contacts   email, domain, name, title, kind (person|hiring_inbox), source (confirmed|published|sent)
 *   outreach   email, domain, company, name, title, status (sent|replied|bounced|failed|pending),
 *              sent_at, replied_at, reply_snippet, campaign
 * Views
 *   delivered          sent or replied, never bounced/failed
 *   company_status     per company: delivered, bounced, replied, still never contacted
 *   uncontacted        researched companies with no email delivered yet
 *
 * Open it with:  sqlite3 data/outreach.db   (or any SQLite viewer, e.g. "DB Browser for SQLite")
 */
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@supabase/supabase-js'

const DB = path.join('data', 'outreach.db')

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [h = [], ...d] = rows
  return d.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? '').trim()])))
}
const cleanDomain = (d: string) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').trim()
const HIRING = /^(careers?|jobs?|hr|hiring|talent|people|recruit\w*|work|join(us)?)@/i
const cityOf = (file: string) => (/^hyd|hyderabad/i.test(file) ? 'Hyderabad' : /^blr|bengaluru|bangalore/i.test(file) ? 'Bengaluru/Pune/India' : '')

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  if (fs.existsSync(DB)) fs.unlinkSync(DB)
  const db = new DatabaseSync(DB)
  db.exec(`
    CREATE TABLE companies (domain TEXT PRIMARY KEY, company TEXT, city TEXT, what_they_do TEXT, funding TEXT,
      founders TEXT, public_email TEXT, source_file TEXT, source_url TEXT);
    CREATE TABLE contacts (email TEXT PRIMARY KEY, domain TEXT, name TEXT, title TEXT, kind TEXT, source TEXT);
    CREATE TABLE outreach (email TEXT, domain TEXT, company TEXT, name TEXT, title TEXT, status TEXT,
      sent_at TEXT, replied_at TEXT, reply_snippet TEXT, error TEXT, campaign TEXT);
    CREATE INDEX outreach_domain ON outreach(domain);
    CREATE INDEX contacts_domain ON contacts(domain);
  `)

  // 1. Researched companies from every research CSV in data/
  const insCo = db.prepare(`INSERT OR IGNORE INTO companies VALUES (?,?,?,?,?,?,?,?,?)`)
  let nCo = 0
  for (const file of fs.readdirSync('data').filter((f) => f.endsWith('.csv')).sort()) {
    const rows = parseCsv(fs.readFileSync(path.join('data', file), 'utf8'))
    if (!rows.length || !('domain' in rows[0]) || !('company' in rows[0])) continue
    for (const r of rows) {
      const d = cleanDomain(r.domain || '')
      if (!d.includes('.')) continue
      nCo += Number(insCo.run(d, r.company, r.city || r.location || cityOf(file), r.what_they_do || '', r.funding || '',
        r.founders || '', r.public_email || '', file, r.source_url || '').changes)
    }
  }

  // 2. Contacts: mail-server-confirmed addresses (finder outputs) and published hiring inboxes
  const insCt = db.prepare(`INSERT OR IGNORE INTO contacts VALUES (?,?,?,?,?,?)`)
  const scratch = process.env.SCRATCH_DIR
  const foundFiles = [
    ...fs.readdirSync('data').filter((f) => /found.*\.csv$/.test(f)).map((f) => path.join('data', f)),
    ...(scratch && fs.existsSync(scratch) ? fs.readdirSync(scratch).filter((f) => /_found\.csv$/.test(f)).map((f) => path.join(scratch, f)) : []),
  ]
  for (const f of foundFiles) {
    for (const r of parseCsv(fs.readFileSync(f, 'utf8'))) {
      const e = (r.email || '').toLowerCase()
      if (!e.includes('@')) continue
      insCt.run(e, e.split('@')[1], r.name || '', r.title || '', HIRING.test(e) ? 'hiring_inbox' : 'person', 'confirmed')
    }
  }
  for (const r of db.prepare(`SELECT domain, public_email FROM companies WHERE public_email <> ''`).all() as any[]) {
    for (const e of String(r.public_email).match(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi) || []) {
      insCt.run(e.toLowerCase(), e.split('@')[1].toLowerCase(), '', '', HIRING.test(e) ? 'hiring_inbox' : 'person', 'published')
    }
  }

  // 3. Outreach: every recipient row in Supabase with its outcome
  const { data: campaigns } = await s.from('campaigns').select('id,name')
  const cname = new Map((campaigns || []).map((c) => [c.id, c.name]))
  const insOut = db.prepare(`INSERT INTO outreach VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  let nOut = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from('email_recipients')
      .select('email,name,company,role,variables,status,sent_at,replied_at,reply_snippet,error_message,bounced_at,campaign_id')
      .order('created_at').range(from, from + 999)
    if (error) throw error
    for (const r of data || []) {
      const e = r.email.toLowerCase()
      const status = r.bounced_at ? 'bounced' : r.error_message && r.status !== 'sent' && r.status !== 'replied' ? 'failed' : r.status
      insOut.run(e, e.split('@')[1], r.company || '', r.name === 'there' ? '' : r.name || '', r.variables?.title || r.role || '',
        status, r.sent_at || null, r.replied_at || null, (r.reply_snippet || '').replace(/\s+/g, ' ').slice(0, 300),
        r.error_message || '', cname.get(r.campaign_id) || '')
      insCt.run(e, e.split('@')[1], r.name === 'there' ? '' : r.name || '', r.variables?.title || r.role || '', HIRING.test(e) ? 'hiring_inbox' : 'person', 'sent')
      nOut++
    }
    if ((data || []).length < 1000) break
  }
  const { data: blocked } = await s.from('blocked_emails').select('email')
  for (const b of blocked || []) db.prepare(`UPDATE outreach SET status='bounced' WHERE email=? AND status IN ('sent','pending')`).run(b.email.toLowerCase())

  db.exec(`
    CREATE VIEW delivered AS
      SELECT * FROM outreach WHERE status IN ('sent','replied') AND sent_at IS NOT NULL AND error = '';
    CREATE VIEW company_status AS
      SELECT d.domain,
        COALESCE((SELECT company FROM companies c WHERE c.domain = d.domain), MAX(o.company)) AS company,
        (SELECT city FROM companies c WHERE c.domain = d.domain) AS city,
        SUM(o.status IN ('sent','replied') AND o.error = '') AS delivered,
        SUM(o.status = 'bounced') AS bounced,
        SUM(o.status = 'replied') AS replied,
        SUM(o.status = 'pending') AS pending,
        MIN(o.sent_at) AS first_sent, MAX(o.sent_at) AS last_sent
      FROM (SELECT domain FROM companies UNION SELECT domain FROM outreach) d
      LEFT JOIN outreach o ON o.domain = d.domain
      GROUP BY d.domain;
    CREATE VIEW uncontacted AS
      SELECT c.* FROM companies c
      WHERE NOT EXISTS (SELECT 1 FROM outreach o WHERE o.domain = c.domain AND o.status IN ('sent','replied','pending'));
  `)

  const one = (sql: string) => Object.values(db.prepare(sql).get() as any)[0]
  console.log(`companies ${nCo}, contacts ${one('SELECT COUNT(*) FROM contacts')}, outreach rows ${nOut}`)
  console.log(`delivered ${one('SELECT COUNT(DISTINCT email) FROM delivered')} at ${one('SELECT COUNT(DISTINCT domain) FROM delivered')} companies, replied ${one(`SELECT COUNT(*) FROM outreach WHERE status='replied'`)}, bounced ${one(`SELECT COUNT(*) FROM outreach WHERE status='bounced'`)}`)
  console.log(`researched companies never contacted: ${one('SELECT COUNT(*) FROM uncontacted')}`)
  console.log(`-> ${DB}`)
  db.close()
}

main().catch((e) => {
  console.error(e?.message || e)
  process.exit(1)
})
