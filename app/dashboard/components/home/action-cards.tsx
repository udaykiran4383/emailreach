'use client'

import Link from 'next/link'
import { ArrowRight, CalendarClock, KanbanSquare, MessageSquareReply, Repeat } from 'lucide-react'
import type { DashboardSummary } from './types'

const CLASSIFICATION_LABELS: Record<string, { label: string; className: string }> = {
  interview_request: { label: 'Interview', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  referral: { label: 'Referral', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  send_resume: { label: 'Send resume', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  interested: { label: 'Interested', className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300' },
}

const STAGE_LABELS: Record<string, string> = {
  target: 'Target',
  contacted: 'Contacted',
  replied: 'Replied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60000)
  const text =
    minutes < 60 ? `${minutes}m` : minutes < 60 * 48 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`
  return diff >= 0 ? `${text} ago` : `in ${text}`
}

function CardShell({
  title,
  icon: Icon,
  href,
  linkLabel,
  children,
  testId,
}: {
  title: string
  icon: typeof Repeat
  href: string
  linkLabel: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section data-testid={testId} className="flex flex-col rounded-2xl border border-border/50 bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h3>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {linkLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex-1">{children}</div>
    </section>
  )
}

export function RepliesToHandle({ replies }: { replies: DashboardSummary['replies'] }) {
  return (
    <CardShell title="Replies to handle" icon={MessageSquareReply} href="/dashboard/replies" linkLabel="All replies" testId="replies-card">
      {replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No interview requests, referrals or resume requests waiting.</p>
      ) : (
        <ul className="space-y-3">
          {replies.map(r => {
            const tag = CLASSIFICATION_LABELS[r.classification]
            return (
              <li key={r.id} className="min-w-0">
                <div className="flex items-center gap-2">
                  {tag && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tag.className}`}>{tag.label}</span>}
                  <span className="truncate text-sm font-medium text-foreground">
                    {r.from}
                    {r.company ? ` · ${r.company}` : ''}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relative(r.receivedAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.snippet || r.subject}</p>
                {r.threadId && (
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${r.threadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open in Gmail
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}

export function FollowUpsDue({ followUps }: { followUps: DashboardSummary['followUpsDue'] }) {
  return (
    <CardShell title="Follow-ups" icon={Repeat} href="/dashboard/campaigns" linkLabel="Campaigns" testId="followups-card">
      {!followUps ? (
        <p className="text-sm text-muted-foreground">Set up sequence steps in a campaign to see follow-ups here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-2xl font-bold tabular-nums text-foreground">{followUps.overdue}</p>
            <p className="text-xs text-muted-foreground">Due now</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-2xl font-bold tabular-nums text-foreground">{followUps.next24h}</p>
            <p className="text-xs text-muted-foreground">Due in the next 24h</p>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Sent automatically for campaigns with auto follow-up on, within your daily limit.
          </p>
        </div>
      )}
    </CardShell>
  )
}

export function NextSteps({ pipeline }: { pipeline: DashboardSummary['pipeline'] }) {
  return (
    <CardShell title="Pipeline" icon={KanbanSquare} href="/dashboard/pipeline" linkLabel="Open board" testId="pipeline-card">
      {!pipeline || pipeline.total === 0 ? (
        <p className="text-sm text-muted-foreground">Companies appear here once you send to them or track a job.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {Object.entries(STAGE_LABELS)
              .filter(([stage]) => pipeline.counts[stage])
              .map(([stage, label]) => (
                <span key={stage} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                  {label} <span className="font-semibold tabular-nums">{pipeline.counts[stage]}</span>
                </span>
              ))}
          </div>
          {pipeline.nextSteps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No next steps due in the next 2 days.</p>
          ) : (
            <ul className="space-y-2">
              {pipeline.nextSteps.map(s => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  <CalendarClock className={`mt-0.5 h-4 w-4 shrink-0 ${s.overdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {s.company}
                      {s.jobTitle ? ` · ${s.jobTitle}` : ''}
                    </p>
                    <p className={`truncate text-xs ${s.overdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                      {s.nextStep || 'Next step'} · {s.overdue ? 'overdue' : relative(s.nextStepAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </CardShell>
  )
}
