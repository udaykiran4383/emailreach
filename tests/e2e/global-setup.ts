import { ChildProcess, execSync, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { APP_URL, DATA_DIR, PORTS, ROOT, appEnv } from './config'
import { startAnthropicMock, stopAnthropicMock } from './mocks/anthropic'
import { startGmailMock, stopGmailMock } from './mocks/gmail'
import { startSitesMock, stopSitesMock } from './mocks/sites'
import { startGateway, startPostgrest, stopGateway, waitFor } from './stack/gateway'
import { resetDatabase, startPostgres, stopPostgres } from './stack/postgres'

function freePort(port: number) {
  try {
    const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: 'pipe' }).toString().trim()
    if (pids) execSync(`kill ${pids.split('\n').join(' ')}`)
  } catch {
    // nothing listening
  }
}

export default async function globalSetup() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  // Leftovers from an interrupted run
  for (const port of [PORTS.app, PORTS.postgrest, PORTS.gateway, PORTS.gmail, PORTS.anthropic, PORTS.jobs, PORTS.sites]) freePort(port)

  let next: ChildProcess | null = null
  const teardown = async () => {
    if (next?.pid) {
      try {
        process.kill(-next.pid, 'SIGTERM')
      } catch {
        next.kill('SIGTERM')
      }
    }
    await Promise.allSettled([stopGateway(), stopGmailMock(), stopAnthropicMock(), stopSitesMock()])
    if (process.env.E2E_KEEP_DB !== '1') stopPostgres()
  }

  try {
    await startPostgres()
    const migrations = await resetDatabase()
    const failed = migrations.filter((m) => !m.ok)
    if (failed.length) {
      console.warn(`\n[e2e] ${failed.length} migration(s) failed on a clean database:`)
      for (const f of failed) console.warn(`  - ${f.file}: ${f.error}`)
    }
    await startPostgrest()
    await startGateway()
    await Promise.all([startGmailMock(), startAnthropicMock(), startSitesMock()])

    const env = appEnv()
    fs.writeFileSync(
      path.join(__dirname, '.env.e2e'),
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n'
    )

    const log = fs.openSync(path.join(DATA_DIR, 'next.log'), 'w')
    const useBuild = process.env.E2E_NEXT_MODE === 'start'
    const cmd = useBuild ? `npx next build && npx next start -p ${PORTS.app} -H 127.0.0.1` : `npx next dev -p ${PORTS.app} -H 127.0.0.1`
    next = spawn('sh', ['-c', cmd], {
      cwd: ROOT,
      env: { ...process.env, ...env, ...(useBuild ? {} : { NODE_ENV: 'development' }) },
      stdio: ['ignore', log, log],
      detached: true, // own process group so teardown kills next + its workers
    })
    await waitFor(`${APP_URL}/auth/login`, useBuild ? 300_000 : 180_000)
  } catch (err) {
    await teardown()
    throw err
  }
  return teardown
}
