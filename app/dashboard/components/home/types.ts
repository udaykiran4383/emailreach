import type { ChartDay } from './activity-chart'

export interface DashboardSummary {
  today: {
    sent: number
    limit: number
    remaining: number
    warmupDay: number
    nextSendAt: string | null
    inWindow: boolean
    windowMessage: string
  } | null
  totals: {
    campaigns: number
    recipients: number
    sent30: number
    opened30: number
    replied30: number
    bounced30: number
    replyRate: number | null
    openRate: number | null
  }
  activeCampaigns: {
    id: string
    name: string
    status: string
    pausedReason: string | null
    total: number
    sent: number
    pending: number
    replied: number
  }[]
  replies: {
    id: string
    campaignName: string
    threadId: string | null
    subject: string
    from: string
    company: string
    snippet: string
    receivedAt: string
    classification: string
  }[]
  followUpsDue: { next24h: number; overdue: number } | null
  pipeline: {
    counts: Record<string, number>
    total: number
    nextSteps: {
      id: string
      company: string
      jobTitle: string | null
      stage: string
      nextStep: string | null
      nextStepAt: string
      overdue: boolean
    }[]
  } | null
  chart: ChartDay[]
  timeZone: string
}

export interface HealthCheckItem {
  id: string
  group: 'database' | 'gmail' | 'background' | 'deliverability' | 'optional'
  label: string
  status: 'ok' | 'warn' | 'error' | 'info'
  detail: string
  fix?: string
  link?: string
  copy?: string[]
}

export interface HealthReportData {
  checks: HealthCheckItem[]
  summary: { ok: number; warn: number; error: number; info: number; total: number }
  checkedAt: string
}
