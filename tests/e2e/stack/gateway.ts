import { ChildProcess, spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { Pool } from 'pg'
import {
  AUTHENTICATOR_PASSWORD,
  DATA_DIR,
  DB_NAME,
  JWT_SECRET,
  PORTS,
  POSTGREST_BIN,
  signJwt,
  verifyJwt,
} from '../config'
import { adminUrl } from './postgres'

/**
 * Local stand-in for Supabase on one port:
 *   /rest/v1/*    -> PostgREST (spawned)
 *   /auth/v1/*    -> minimal GoTrue (signup, password/refresh token, user, logout, admin getUser)
 *   /storage/v1/* -> filesystem-backed object storage
 */

const STORAGE_DIR = path.join(DATA_DIR, 'storage')
let postgrest: ChildProcess | null = null
let server: http.Server | null = null
let pool: Pool | null = null

export async function startPostgrest() {
  postgrest = spawn(POSTGREST_BIN, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${AUTHENTICATOR_PASSWORD}@127.0.0.1:${PORTS.postgres}/${DB_NAME}`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(PORTS.postgrest),
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_DB_CHANNEL_ENABLED: 'true',
      PGRST_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = fs.createWriteStream(path.join(DATA_DIR, 'postgrest.log'))
  postgrest.stdout?.pipe(log)
  postgrest.stderr?.pipe(log)
  await waitFor(`http://127.0.0.1:${PORTS.postgrest}/`, 30_000)
}

export async function waitFor(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(`e2e:${password}`).digest('hex')
}

function userObject(row: any) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: row.created_at,
    confirmed_at: row.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

const refreshTokens = new Map<string, string>() // refresh token -> user id

function session(row: any) {
  const expiresIn = 3600
  const now = Math.floor(Date.now() / 1000)
  const access_token = signJwt({
    aud: 'authenticated',
    role: 'authenticated',
    sub: row.id,
    email: row.email,
    iat: now,
    exp: now + expiresIn,
    session_id: crypto.randomUUID(),
  })
  const refresh_token = crypto.randomBytes(16).toString('hex')
  refreshTokens.set(refresh_token, row.id)
  return {
    access_token,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token,
    user: userObject(row),
  }
}

async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = url.pathname.replace(/^\/auth\/v1/, '')
  const db = pool!
  if (p === '/settings') return json(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true })
  if (p === '/health') return json(res, 200, { name: 'GoTrue-e2e' })

  if (p === '/signup' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    if (!body.email || !body.password) return json(res, 422, { code: 422, msg: 'Signup requires email and password' })
    const existing = await db.query('SELECT * FROM auth.users WHERE email = $1', [body.email.toLowerCase()])
    if (existing.rowCount) return json(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' })
    const { rows } = await db.query(
      'INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data) VALUES ($1, $2, $3) RETURNING *',
      [body.email.toLowerCase(), hashPassword(body.password), body.data || {}]
    )
    return json(res, 200, session(rows[0]))
  }

  if (p === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type')
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    if (grant === 'password') {
      const { rows } = await db.query('SELECT * FROM auth.users WHERE email = $1', [String(body.email || '').toLowerCase()])
      if (!rows[0] || rows[0].encrypted_password !== hashPassword(body.password || '')) {
        return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      }
      return json(res, 200, session(rows[0]))
    }
    if (grant === 'refresh_token') {
      const userId = refreshTokens.get(body.refresh_token)
      if (!userId) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', error_code: 'refresh_token_not_found' })
      refreshTokens.delete(body.refresh_token)
      const { rows } = await db.query('SELECT * FROM auth.users WHERE id = $1', [userId])
      return json(res, 200, session(rows[0]))
    }
    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const claims = verifyJwt(bearer)

  if (p === '/user' && req.method === 'GET') {
    if (!claims?.sub) return json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
    const { rows } = await db.query('SELECT * FROM auth.users WHERE id = $1', [claims.sub])
    if (!rows[0]) return json(res, 403, { code: 403, error_code: 'user_not_found', msg: 'User not found' })
    return json(res, 200, userObject(rows[0]))
  }

  if (p === '/logout') {
    res.writeHead(204)
    return res.end()
  }

  const adminUser = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/)
  if (adminUser && req.method === 'GET') {
    if (claims?.role !== 'service_role') return json(res, 403, { msg: 'forbidden' })
    const { rows } = await db.query('SELECT * FROM auth.users WHERE id = $1', [adminUser[1]])
    if (!rows[0]) return json(res, 404, { code: 404, msg: 'User not found' })
    return json(res, 200, userObject(rows[0]))
  }

  return json(res, 404, { code: 404, msg: `e2e auth: ${req.method} ${p} not implemented` })
}

async function handleStorage(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  // /storage/v1/object/{bucket}/{path} | /object/authenticated/... | /object/public/...
  const m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/|public\/)?([^/]+)\/(.+)$/)
  if (!m) return json(res, 404, { statusCode: '404', error: 'not_found', message: `e2e storage: ${url.pathname}` })
  const [, bucket, objectPath] = m
  const file = path.join(STORAGE_DIR, bucket, decodeURIComponent(objectPath))
  if (!file.startsWith(STORAGE_DIR)) return json(res, 400, { message: 'bad path' })

  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readBody(req)
    if (fs.existsSync(file) && req.method === 'POST' && req.headers['x-upsert'] !== 'true') {
      return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    fs.writeFileSync(`${file}.meta.json`, JSON.stringify({ contentType: req.headers['content-type'] || 'application/octet-stream' }))
    return json(res, 200, { Key: `${bucket}/${objectPath}`, Id: crypto.randomUUID() })
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!fs.existsSync(file)) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
    let contentType = 'application/octet-stream'
    try {
      contentType = JSON.parse(fs.readFileSync(`${file}.meta.json`, 'utf8')).contentType
    } catch {}
    res.writeHead(200, { 'content-type': contentType })
    return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file))
  }
  if (req.method === 'DELETE') {
    fs.rmSync(file, { force: true })
    return json(res, 200, [])
  }
  return json(res, 405, { message: 'method not allowed' })
}

function proxyRest(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const target = `${url.pathname.replace(/^\/rest\/v1/, '') || '/'}${url.search}`
  const headers = { ...req.headers, host: `127.0.0.1:${PORTS.postgrest}` }
  // supabase-js sends the anon/service key as both apikey and Authorization; PostgREST only reads Authorization.
  const apikey = req.headers['apikey'] as string | undefined
  if (!headers.authorization && apikey) headers.authorization = `Bearer ${apikey}`
  const upstream = http.request(
    { host: '127.0.0.1', port: PORTS.postgrest, path: target, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', (err) => json(res, 502, { message: `PostgREST unavailable: ${err.message}` }))
  req.pipe(upstream)
}

export async function startGateway() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
  pool = new Pool({ connectionString: adminUrl(DB_NAME), max: 5 })
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORTS.gateway}`)
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        })
        return res.end()
      }
      if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url)
      if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url)
      if (url.pathname.startsWith('/storage/v1')) return await handleStorage(req, res, url)
      json(res, 404, { message: `e2e gateway: no route for ${url.pathname}` })
    } catch (err: any) {
      json(res, 500, { message: err.message })
    }
  })
  await new Promise<void>((resolve) => server!.listen(PORTS.gateway, '127.0.0.1', resolve))
}

export async function stopGateway() {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  await pool?.end().catch(() => {})
  postgrest?.kill('SIGTERM')
}
