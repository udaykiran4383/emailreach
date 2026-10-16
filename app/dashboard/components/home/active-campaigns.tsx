'use client'

import Link from 'next/link'
import { PauseCircle, PlayCircle, Rocket } from 'lucide-react'
import type { DashboardSummary } from './types'

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  sending: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  paused: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  draft: 'bg-muted text-muted-foreground',
}

export default function ActiveCampaigns({ campaigns }: { campaigns: DashboardSummary['activeCampaigns'] }) {
  return (
    <section data-testid="active-campaigns" className="rounded-2xl border border-border/50 bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
        <Rocket className="h-4 w-4 text-primary" /> Active campaigns
      </h3>
      {campaigns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is sending right now.</p>
      ) : (
        <ul className="space-y-4">
          {campaigns.map(c => {
            const pct = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0
            return (
              <li key={c.id}>
                <Link href={`/dashboard/campaigns/${c.id}`} className="group block">
                  <div className="flex items-center gap-2">
                    {c.status === 'paused' ? (
                      <PauseCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                    ) : (
                      <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">{c.name}</span>
                    <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[c.status] || STATUS_STYLES.draft}`}>
                      {c.status}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={c.sent}
                    aria-valuemin={0}
                    aria-valuemax={c.total}
                    aria-label={`${c.name} progress`}
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.sent} of {c.total} sent · {c.pending} pending · {c.replied} replied
                    {c.pausedReason ? ` · ${c.pausedReason}` : ''}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
