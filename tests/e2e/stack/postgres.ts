import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Client } from 'pg'
import { DATA_DIR, DB_NAME, DB_SUPERUSER, PG_BIN, PORTS, ROOT } from '../config'

const PGDATA = path.join(DATA_DIR, 'pg')
const LOG = path.join(DATA_DIR, 'postgres.log')

function pg(bin: string, args: string[]) {
  return execFileSync(path.join(PG_BIN, bin), args, { stdio: 'pipe', env: { ...process.env, LC_ALL: 'en_US.UTF-8' } })
}

/** Starts a throwaway cluster on PORTS.postgres (never the system Postgres). */
export async function startPostgres() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(path.join(PGDATA, 'PG_VERSION'))) {
    pg('initdb', ['-D', PGDATA, '-U', DB_SUPERUSER, '--auth=trust', '--no-locale', '-E', 'UTF8'])
  }
  const running = (() => {
    try {
      pg('pg_ctl', ['-D', PGDATA, 'status'])
      return true
    } catch {
      return false
    }
  })()
  if (!running) {
    pg('pg_ctl', ['-D', PGDATA, '-l', LOG, '-o', `-p ${PORTS.postgres} -k /tmp -h 127.0.0.1`, '-w', 'start'])
  }
}

export function stopPostgres() {
  try {
    pg('pg_ctl', ['-D', PGDATA, '-m', 'fast', 'stop'])
  } catch {
    // already stopped
  }
}

export function adminUrl(db = 'postgres') {
  return `postgres://${DB_SUPERUSER}@127.0.0.1:${PORTS.postgres}/${db}`
}

export interface MigrationResult {
  file: string
  ok: boolean
  error?: string
}

/**
 * Recreates the e2e database from scratch and applies bootstrap + the app's migrations in order.
 * Failures are collected (and reported by the suite) instead of aborting: a migration that fails on a
 * clean database is a real bug for the user.
 */
export async function resetDatabase(): Promise<MigrationResult[]> {
  const admin = new Client({ connectionString: adminUrl() })
  await admin.connect()
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB_NAME])
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
  await admin.query(`CREATE DATABASE ${DB_NAME}`)
  await admin.end()

  const db = new Client({ connectionString: adminUrl(DB_NAME) })
  await db.connect()
  await db.query(fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8'))

  const scriptsDir = path.join(ROOT, 'scripts')
  const files = fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.sql'))
    // 02_personal_schema.sql drops and recreates every table without auth — not part of the real setup
    .filter((f) => !f.startsWith('02_'))
    .sort()

  const results: MigrationResult[] = []
  for (const file of files) {
    const sql = fs.readFileSync(path.join(scriptsDir, file), 'utf8')
    try {
      await db.query('BEGIN')
      await db.query(sql)
      await db.query('COMMIT')
      results.push({ file, ok: true })
    } catch (err: any) {
      await db.query('ROLLBACK').catch(() => {})
      results.push({ file, ok: false, error: err.message })
    }
  }
  // Re-run grants for tables created by migrations (default privileges cover most, this is belt and braces)
  await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
                  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;`)
  // Supabase ships a 'resumes' bucket via the dashboard; our storage stand-in is filesystem based.
  await db.query(`NOTIFY pgrst, 'reload schema'`)
  await db.end()
  fs.writeFileSync(path.join(DATA_DIR, 'migrations.json'), JSON.stringify(results, null, 2))
  return results
}
