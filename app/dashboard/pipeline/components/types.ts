import type { Stage } from '@/lib/pipeline/stages'

export interface PipelineContact {
  email: string
  name: string | null
  status: string
  opened_at: string | null
  replied_at: string | null
  campaign_name: string | null
}

export interface PipelineApplication {
  id: string
  company: string
  domain: string
  job_title: string | null
  job_url: string | null
  stage: Stage
  source: string | null
  notes: string | null
  next_step: string | null
  next_step_at: string | null
  created_at: string
  updated_at: string
  stage_changed_at: string | null
  contacts: PipelineContact[]
  last_activity: { message: string; created_at: string } | null
}

export interface PipelineActivity {
  id: string
  kind: 'stage_change' | 'note' | 'email_sent' | 'reply' | 'system'
  message: string
  created_at: string
}

export const STAGE_STYLES: Record<Stage, { dot: string; badge: string }> = {
  target: { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  contacted: { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  replied: { dot: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  interview: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  offer: { dot: 'bg-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
  rejected: { dot: 'bg-red-400', badge: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
}

export function isOverdue(iso: string | null): boolean {
  return !!iso && new Date(iso).getTime() < Date.now()
}

export function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  const text = minutes < 60 ? `${minutes}m` : hours < 24 ? `${hours}h` : `${days}d`
  return diff >= 0 ? `${text} ago` : `in ${text}`
}
