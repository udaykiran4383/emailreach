'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { HealthReportData } from './types'

export default function SetupBanner({ health }: { health: HealthReportData | null }) {
  const errors = health?.checks.filter(c => c.status === 'error') || []
  if (!errors.length) return null

  return (
    <div
      role="alert"
      data-testid="setup-banner"
      className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div>
          <p className="font-medium text-red-900 dark:text-red-200">
            {errors.length} setup issue{errors.length === 1 ? '' : 's'} need attention
          </p>
          <p className="text-sm text-red-800/80 dark:text-red-300/80">
            {errors
              .slice(0, 3)
              .map(e => e.label)
              .join(' · ')}
            {errors.length > 3 ? ` · +${errors.length - 3} more` : ''}
          </p>
        </div>
      </div>
      <Link
        href="/dashboard/setup"
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 sm:self-auto"
      >
        Open checklist <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}
