/**
 * Lists named leaders (CEO, CTO, founders, board of directors, managers, HR) found on each company's
 * own website, for companies whose mail server won't let us confirm addresses (Microsoft 365, Zoho …).
 * Emails are NOT confirmed: email_guess is filled only when the company's own published addresses
 * show its naming pattern. Output is kept out of the confirmed-contacts table.
 *
 *   npx tsx --env-file=.env.local scripts/dev/people-unverified.ts <companies.csv> <out.csv>
 *   companies.csv needs: company,domain
 */
import fs from 'fs'
import { findCompanyContacts } from '../../lib/email/people-finder'

function parse(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = '' } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' } else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [h, ...d] = rows
  return d.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? '').trim()])))
}
const q = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)

async function main() {
  const [inFile, outFile] = process.argv.slice(2)
  const companies = parse(fs.readFileSync(inFile, 'utf8'))
  const out = ['name,title,role,company,company_domain,source_url,email_guess,note']
  for (const c of companies) {
    const { contacts, company } = await findCompanyContacts(`https://${c.domain}`, { roles: [], verify: false, guessPatterns: true, namesOnly: true, deadline: Date.now() + 45_000 })
    const seen = new Set<string>()
    for (const p of contacts) {
      if (!p.name || p.role === 'other') continue
      const k = p.name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      const guess = p.source === 'website' ? p.email : p.confidence >= 50 ? p.email : ''
      out.push([p.name, p.title, p.role, c.company, c.domain, p.sourceUrl || '', guess, p.source === 'website' ? 'published on site' : guess ? 'pattern guess, unverified' : 'name only'].map(q).join(','))
    }
    console.log(`${c.domain}: ${seen.size} people, pattern ${company.pattern || 'unknown'}`)
  }
  fs.writeFileSync(outFile, out.join('\n') + '\n')
  console.log(`${out.length - 1} people -> ${outFile}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
