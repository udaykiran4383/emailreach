/**
 * Finds real founder/engineer addresses for researched companies from public GitHub commit metadata:
 * the company's GitHub org -> recent commits -> author emails on the company's own domain.
 * These are mailboxes people actually use, so they don't depend on the mail-server check.
 *
 *   GH_TOKEN=$(gh auth token --user udaykiran4383) npx tsx scripts/dev/github-emails.ts <out.csv> <in1.csv> [...]
 *
 * Inputs: research CSVs with company,domain,founders. Output: email,name,company,title,first_name
 * (title is the founder's title when the commit author matches a listed founder, else "Engineer").
 */
import fs from 'fs'

const TOKEN = process.env.GH_TOKEN
if (!TOKEN) throw new Error('Set GH_TOKEN')

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = '' } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' } else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [h = [], ...d] = rows
  return d.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? '').trim()])))
}
const q = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)
const cleanDomain = (d: string) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').trim()
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function gh(path: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    if (!res) { await sleep(2000); continue }
    if (res.status === 403 || res.status === 429) { await sleep(60_000); continue }
    if (!res.ok) return null
    return res.json()
  }
  return null
}

async function findOrg(domain: string, company: string): Promise<string | null> {
  const base = domain.split('.')[0]
  // Direct guesses first (cheap), then search; accept an org only if its blog/email points at the domain
  const candidates = new Set([base, company.toLowerCase().replace(/[^a-z0-9]/g, ''), `${base}hq`, `${base}-ai`, `${base}ai`, `${base}-hq`])
  const search = await gh(`/search/users?q=${encodeURIComponent(domain)}+type:org&per_page=5`)
  for (const u of search?.items || []) candidates.add(u.login)
  await sleep(2000) // search API: 30/min
  for (const login of candidates) {
    if (!login) continue
    const o = await gh(`/orgs/${login}`)
    if (o && [o.blog, o.email, o.description].some((x: string) => (x || '').toLowerCase().includes(domain))) return o.login
  }
  return null
}

async function main() {
  const [outFile, ...inputs] = process.argv.slice(2)
  const companies = new Map<string, any>()
  for (const f of inputs) for (const r of parseCsv(fs.readFileSync(f, 'utf8'))) {
    const d = cleanDomain(r.domain || '')
    if (d.includes('.') && !companies.has(d)) companies.set(d, r)
  }
  const out: string[] = []
  let i = 0
  for (const [domain, r] of companies) {
    i++
    const founders = (r.founders || '').split(/;/).map((p: string) => p.trim().match(/^([^()]+?)\s*(?:\(([^)]*)\))?$/)).filter(Boolean)
      .map((m: any) => ({ name: m[1].trim(), title: m[2] || 'Co-Founder' }))
    const org = await findOrg(domain, r.company || '')
    if (!org) continue
    const repos = (await gh(`/orgs/${org}/repos?sort=pushed&per_page=8`)) || []
    const emails = new Map<string, string>()
    for (const repo of repos.filter((x: any) => !x.fork).slice(0, 6)) {
      const commits = (await gh(`/repos/${org}/${repo.name}/commits?per_page=100`)) || []
      for (const c of commits) {
        const a = c.commit?.author
        const e = (a?.email || '').toLowerCase()
        if (e.endsWith('@' + domain) && !/noreply|bot|github|ci@|build|deploy|admin@|dev@|info@|support@/.test(e)) emails.set(e, a.name || '')
      }
    }
    let found = 0
    for (const [email, author] of emails) {
      const f = founders.find((p: any) => {
        const [first, ...rest] = norm(p.name).split(' ')
        const local = email.split('@')[0].replace(/[^a-z]/g, '')
        return norm(author).includes(first) || (first.length >= 3 && local.startsWith(first)) || (rest.length && local.includes(rest[rest.length - 1]) && local.startsWith(first[0]))
      })
      const name = f?.name || author
      const first = (name.split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '')
      out.push([email, name, r.company, f?.title || 'Engineer', first].map((x) => q(x || '')).join(','))
      found++
    }
    console.log(`[${i}/${companies.size}] ${domain} org=${org} emails=${found}`)
  }
  fs.writeFileSync(outFile, ['email,name,company,title,first_name', ...out].join('\n') + '\n')
  console.log(`GitHub: ${out.length} addresses -> ${outFile}`)
}

main().catch((e) => {
  console.error(e?.message || e)
  process.exit(1)
})
