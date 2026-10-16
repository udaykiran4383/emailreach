import crypto from 'crypto'
import path from 'path'

/** Fixed ports + secrets for the local e2e stack. Nothing here is a real credential. */
export const PORTS = {
  postgres: 54329,
  postgrest: 54322,
  gateway: 54321, // fake Supabase (rest + auth + storage)
  gmail: 54340, // mock Gmail API + Google OAuth token endpoint
  anthropic: 54341,
  jobs: 54342, // mock Greenhouse / Lever / Ashby
  sites: 54343, // fixture company websites + unsubscribe endpoints
  app: 3100,
}

export const ROOT = path.resolve(__dirname, '../..')
export const DATA_DIR = path.join(__dirname, '.data')
export const PG_BIN = process.env.E2E_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin'
export const POSTGREST_BIN = process.env.E2E_POSTGREST_BIN || '/opt/homebrew/bin/postgrest'

export const DB_NAME = 'emailreach_e2e'
export const DB_SUPERUSER = 'postgres'
export const AUTHENTICATOR_PASSWORD = 'e2e-authenticator'
export const DB_URL = `postgres://${DB_SUPERUSER}@127.0.0.1:${PORTS.postgres}/${DB_NAME}`

export const JWT_SECRET = 'e2e-super-secret-jwt-token-with-at-least-32-characters'
export const CRON_SECRET = 'e2e-cron-secret'
export const TRACKING_SECRET = 'e2e-tracking-secret'
// Public-looking base URL so tracking pixels / resume links get generated (localhost is refused on purpose).
// Specs rewrite this host to 127.0.0.1:PORTS.app when they follow the links.
export const PUBLIC_BASE_URL = `http://app.e2e.test:${PORTS.app}`
export const APP_URL = `http://127.0.0.1:${PORTS.app}`
export const SUPABASE_URL = `http://127.0.0.1:${PORTS.gateway}`

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

export function signJwt(payload: Record<string, unknown>, secret = JWT_SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token: string, secret = JWT_SECRET): Record<string, any> | null {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) return null
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')
  if (expected !== s) return null
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString())
  if (payload.exp && payload.exp * 1000 < Date.now()) return null
  return payload
}

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600
export const ANON_KEY = signJwt({ iss: 'supabase-e2e', role: 'anon', exp: FAR_FUTURE })
export const SERVICE_ROLE_KEY = signJwt({ iss: 'supabase-e2e', role: 'service_role', exp: FAR_FUTURE })

/** Environment for the Next.js app under test. */
export function appEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SITE_URL: PUBLIC_BASE_URL,
    NEXT_PUBLIC_ENABLE_EMAIL_LOGIN: 'true',
    NEXT_DIST_DIR: '.next-e2e',
    TRACKING_BASE_URL: PUBLIC_BASE_URL,
    TRACKING_SECRET,
    CRON_SECRET,
    GMAIL_CLIENT_ID: 'e2e-client-id',
    GMAIL_CLIENT_SECRET: 'e2e-client-secret',
    GMAIL_REDIRECT_URI: `${APP_URL}/api/gmail/callback`,
    E2E_MODE: '1',
    E2E_ALLOW_PRIVATE_FETCH: '1',
    GMAIL_API_ROOT_URL: `http://127.0.0.1:${PORTS.gmail}`,
    E2E_SITES_URL: `http://127.0.0.1:${PORTS.sites}`,
    ANTHROPIC_API_KEY: 'e2e-anthropic-key',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORTS.anthropic}`,
    JOBS_GREENHOUSE_BASE: `http://127.0.0.1:${PORTS.jobs}/greenhouse`,
    JOBS_LEVER_BASE: `http://127.0.0.1:${PORTS.jobs}/lever`,
    JOBS_ASHBY_BASE: `http://127.0.0.1:${PORTS.jobs}/ashby`,
    SEND_MAX_RUN_SECONDS: '8',
    NEXT_TELEMETRY_DISABLED: '1',
  }
}
