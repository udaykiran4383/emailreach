'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock, Gauge, Moon, Settings2, Send } from 'lucide-react'
import type { DashboardSummary } from './types'

function useCountdown(target: string | null) {
  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (!target) {
      setSeconds(null)
      return
    }
    const tick = () => setSeconds(Math.max(0, Math.round((new Date(target).getTime() - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])
  return seconds
}

function formatSeconds(s: number) {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function TodayCard({ today }: { today: DashboardSummary['today'] }) {
  const seconds = useCountdown(today?.nextSendAt ?? null)

  if (!today) {
    return (
      <section data-testid="today-card" className="rounded-2xl border border-border/50 bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-foreground">
          <Gauge className="h-5 w-5 text-primary" /> Today
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sending limits aren't available yet. Finish the{' '}
          <Link href="/dashboard/setup" className="font-medium text-primary hover:underline">
            setup checklist
          </Link>{' '}
          to start sending.
        </p>
      </section>
    )
  }

  const pct = today.limit > 0 ? Math.min(100, Math.round((today.sent / today.limit) * 100)) : 0
  const limitReached = today.remaining <= 0

  let status: { icon: typeof Send; text: string; tone: string }
  if (limitReached) {
    status = { icon: Moon, text: 'Daily limit reached: sending resumes as the 24h window rolls forward', tone: 'text-amber-600 dark:text-amber-400' }
  } else if (!today.inWindow) {
    status = { icon: Moon, text: today.windowMessage || 'Outside your sending hours', tone: 'text-muted-foreground' }
  } else if (seconds !== null && seconds > 0) {
    status = { icon: Clock, text: `Next email in ${formatSeconds(seconds)}`, tone: 'text-foreground' }
  } else {
    status = { icon: Send, text: 'Ready to send', tone: 'text-emerald-600 dark:text-emerald-400' }
  }
  const StatusIcon = status.icon

  return (
    <section data-testid="today-card" className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Gauge className="h-5 w-5 text-primary" /> Today
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Rolling 24 hours{today.warmupDay > 0 ? ` · warm-up day ${today.warmupDay}` : ''}
          </p>
        </div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" /> Limits
        </Link>
      </div>

      <p className="mt-4 text-3xl font-bold tabular-nums text-foreground">
        {today.sent}
        <span className="text-lg font-medium text-muted-foreground"> / {today.limit} sent</span>
      </p>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={today.sent}
        aria-valuemin={0}
        aria-valuemax={today.limit}
        aria-label="Emails sent today"
      >
        <div className={`h-full rounded-full ${limitReached ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-3 flex items-center gap-1.5 text-sm ${status.tone}`}>
        <StatusIcon className="h-4 w-4 shrink-0" />
        {status.text}
      </p>
    </section>
  )
}
