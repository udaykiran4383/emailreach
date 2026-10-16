'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import type { HealthCheckItem, HealthReportData } from '../components/home/types'

const GROUPS: { id: HealthCheckItem['group']; title: string; description: string }[] = [
  { id: 'database', title: 'Database', description: 'SQL migrations in scripts/, run in number order in the Supabase SQL Editor' },
  { id: 'gmail', title: 'Gmail', description: 'The account emails are sent from' },
  { id: 'background', title: 'Background sending', description: 'Keeps drip campaigns and follow-ups going when the app is closed' },
  { id: 'deliverability', title: 'Deliverability', description: 'Keeps your emails out of spam and your account in good standing' },
  { id: 'optional', title: 'Optional services', description: 'Extra features that need an API key' },
]

const STATUS_META: Record<HealthCheckItem['status'], { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'OK' },
  warn: { icon: AlertTriangle, className: 'text-amber-600 dark:text-amber-400', label: 'Warning' },
  error: { icon: XCircle, className: 'text-red-600 dark:text-red-400', label: 'Needs fixing' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Optional' },
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${text}`)
  } catch {
    toast.error('Could not copy to clipboard')
  }
}

function CheckRow({ check }: { check: HealthCheckItem }) {
  const meta = STATUS_META[check.status]
  const Icon = meta.icon
  return (
    <li data-testid={`check-${check.id}`} data-status={check.status} className="flex gap-3 py-3">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.className}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-medium text-foreground">{check.label}</p>
          <span className={`text-xs ${meta.className}`}>{meta.label}</span>
        </div>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">{check.detail}</p>
        {check.status !== 'ok' && check.fix && <p className="mt-1.5 text-sm text-foreground">{check.fix}</p>}
        {check.status !== 'ok' && (check.copy?.length || check.link) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {check.copy?.map(text => (
              <button
                key={text}
                type="button"
                onClick={() => copyText(text)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs text-foreground hover:bg-muted"
                title="Copy to clipboard"
              >
                {text}
                <Copy className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
            {check.link && (
              <Link href={check.link} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Go there <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export default function SetupPage() {
  const [report, setReport] = useState<HealthReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      setReport(await res.json())
    } catch (err: any) {
      setError(err.message || 'Failed to run checks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const required = report ? report.checks.filter(c => c.status !== 'info') : []
  const passed = required.filter(c => c.status === 'ok').length
  const pct = required.length ? Math.round((passed / required.length) * 100) : 0

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8 animate-enter">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-foreground">
            <ListChecks className="h-7 w-7 text-primary" />
            Setup checklist
          </h1>
          <p className="mt-2 text-muted-foreground">Everything EmailReach needs to send safely, checked live.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Re-check
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          Could not run the checks: {error}
        </div>
      )}

      {!report && loading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/50 bg-card py-20">
          <Loader2 className="mb-3 h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Running checks…</p>
        </div>
      ) : report ? (
        <>
          <section className="rounded-2xl border border-border/50 bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-foreground">
                {passed} of {required.length} checks passing
              </p>
              <p className="text-xs text-muted-foreground">
                {report.summary.error} to fix · {report.summary.warn} warning{report.summary.warn === 1 ? '' : 's'} · checked{' '}
                {new Date(report.checkedAt).toLocaleTimeString()}
              </p>
            </div>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={passed}
              aria-valuemin={0}
              aria-valuemax={required.length}
              aria-label="Setup progress"
            >
              <div
                className={`h-full rounded-full ${report.summary.error ? 'bg-red-500' : report.summary.warn ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </section>

          {GROUPS.map(group => {
            const checks = report.checks.filter(c => c.group === group.id)
            if (!checks.length) return null
            const worst = checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok'
            const WorstIcon = STATUS_META[worst].icon
            return (
              <section key={group.id} data-testid={`group-${group.id}`} className="rounded-2xl border border-border/50 bg-card px-5 pt-4 pb-2">
                <div className="flex items-start gap-2">
                  <WorstIcon className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_META[worst].className}`} aria-hidden />
                  <div>
                    <h2 className="font-semibold text-foreground">{group.title}</h2>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>
                </div>
                <ul className="mt-1 divide-y divide-border/60">
                  {checks.map(check => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </ul>
              </section>
            )
          })}
        </>
      ) : null}
    </div>
  )
}
