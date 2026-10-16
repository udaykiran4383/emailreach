import http from 'http'
import { PORTS } from '../config'

/**
 * Fixture websites for *.test hosts (the app's fetch is routed here by instrumentation.ts, which passes
 * the original host in x-e2e-host), plus mock Greenhouse/Lever/Ashby job boards on PORTS.jobs.
 * Also records one-click unsubscribe POSTs: GET /__control/unsubscribes
 */

export const unsubscribes: { host: string; path: string; body: string }[] = []

const layout = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About us</a> <a href="/team">Our Team</a> <a href="/careers">Careers</a> <a href="/contact">Contact</a></nav>
${body}
<footer>© Acme Corp</footer></body></html>`

const ACME: Record<string, string> = {
  '/': layout(
    'Acme Corp',
    `<h1>Acme Rockets for small teams</h1>
     <p>Acme Rockets helps small engineering teams ship faster. Press: press@acmecorp.test</p>
     <img src="logo@2x.png"> <a href="mailto:jane.doe@acmecorp.test?subject=Hi">Email Jane</a>`
  ),
  '/about': layout('About Acme', `<h1>About</h1><p>Founded in 2019. We build Acme Rockets.</p><a href="/team">Meet the leadership team</a>`),
  '/team': layout(
    'Team',
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Acme Corp',
      employee: [{ '@type': 'Person', name: 'Priya Sharma', jobTitle: 'Chief Executive Officer' }],
    })}</script>
     <h1>Leadership team</h1>
     <div class="team-grid">
       <div class="team-card"><h3>Rahul Verma</h3><p class="title">Chief Technology Officer</p></div>
       <div class="team-card"><h3>Anita Desai</h3><p class="title">Head of Talent Acquisition</p></div>
       <div class="team-card"><h3>Karthik Rao</h3><p class="title">Engineering Manager</p><a href="mailto:karthik.rao@acmecorp.test">Email</a></div>
       <div class="team-card"><h3>Jane Doe</h3><p class="title">Senior Software Engineer</p><a href="mailto:jane.doe@acmecorp.test">Email</a></div>
     </div>`
  ),
  '/careers': layout(
    'Careers',
    `<h1>Join us</h1><p>See open roles on our <a href="https://boards.greenhouse.io/acmecorp">job board</a>.
     Questions? careers@acmecorp.test</p>`
  ),
  '/contact': layout(
    'Contact',
    `<h1>Contact</h1><p>Sales: sales [at] acmecorp [dot] test</p>
     <p>Support: <a href="mailto:support%40acmecorp.test">support</a></p>
     <p>HR: hr&#64;acmecorp&#46;test</p>
     <p>Not an email: icon@2x.png, someone@example.com</p>`
  ),
}

function handleSite(req: http.IncomingMessage, res: http.ServerResponse, body: string) {
  const host = String(req.headers['x-e2e-host'] || req.headers.host || '').toLowerCase()
  const url = new URL(req.url || '/', 'http://x')
  if (url.pathname === '/__control/unsubscribes') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ unsubscribes }))
  }
  if (host.startsWith('lists.') || url.pathname.startsWith('/unsubscribe')) {
    if (req.method === 'POST') unsubscribes.push({ host, path: url.pathname + url.search, body })
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('unsubscribed')
  }
  if (host === 'acmecorp.test' || host === 'www.acmecorp.test') {
    const page = ACME[url.pathname.replace(/\/$/, '') || '/']
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
  }
  res.writeHead(404, { 'content-type': 'text/html' })
  res.end('<h1>Not found</h1>')
}

const GREENHOUSE_JOBS = {
  jobs: [
    {
      id: 101,
      title: 'Backend Engineer (Node.js)',
      absolute_url: 'https://boards.greenhouse.io/acmecorp/jobs/101',
      location: { name: 'Bengaluru, India' },
      updated_at: new Date().toISOString(),
      departments: [{ name: 'Engineering' }],
      content: '&lt;p&gt;Build APIs with Node.js, TypeScript and Postgres.&lt;/p&gt;',
    },
    {
      id: 102,
      title: 'Senior Frontend Engineer',
      absolute_url: 'https://boards.greenhouse.io/acmecorp/jobs/102',
      location: { name: 'Remote' },
      updated_at: new Date().toISOString(),
      departments: [{ name: 'Engineering' }],
      content: '&lt;p&gt;React and Next.js.&lt;/p&gt;',
    },
    {
      id: 103,
      title: 'Account Executive',
      absolute_url: 'https://boards.greenhouse.io/acmecorp/jobs/103',
      location: { name: 'New York' },
      updated_at: new Date().toISOString(),
      departments: [{ name: 'Sales' }],
      content: '&lt;p&gt;Sell rockets.&lt;/p&gt;',
    },
  ],
  meta: { total: 3 },
}

function handleJobs(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', 'http://x')
  if (url.pathname === '/greenhouse/v1/boards/acmecorp/jobs') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(GREENHOUSE_JOBS))
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}

let sites: http.Server | null = null
let jobs: http.Server | null = null

export async function startSitesMock() {
  sites = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => handleSite(req, res, Buffer.concat(chunks).toString()))
  })
  jobs = http.createServer(handleJobs)
  await new Promise<void>((resolve) => sites!.listen(PORTS.sites, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => jobs!.listen(PORTS.jobs, '127.0.0.1', resolve))
}

export async function stopSitesMock() {
  await new Promise<void>((resolve) => (sites ? sites.close(() => resolve()) : resolve()))
  await new Promise<void>((resolve) => (jobs ? jobs.close(() => resolve()) : resolve()))
}
