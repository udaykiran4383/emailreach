'use client'

import { Users, CalendarClock, Briefcase } from 'lucide-react'
import { STAGES, STAGE_LABELS, type Stage } from '@/lib/pipeline/stages'
import { PipelineApplication, formatRelative, isOverdue } from './types'

export default function ApplicationCard({
  application,
  onOpen,
  onStageChange,
}: {
  application: PipelineApplication
  onOpen: () => void
  onStageChange: (stage: Stage) => void
}) {
  const repliedContacts = application.contacts.filter((c) => c.replied_at || c.status === 'replied').length
  const overdue = isOverdue(application.next_step_at)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', application.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen()
      }}
      tabIndex={0}
      role="button"
      aria-label={`${application.company}${application.job_title ? `, ${application.job_title}` : ''}`}
      className="group bg-card border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">{application.company}</p>
          <p className="text-xs text-muted-foreground truncate">{application.domain}</p>
        </div>
      </div>

      {application.job_title && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/80 truncate">
          <Briefcase className="w-3 h-3 shrink-0" />
          <span className="truncate">{application.job_title}</span>
        </p>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="w-3 h-3" />
          {application.contacts.length}
          {repliedContacts > 0 && <span className="text-violet-600 dark:text-violet-400">· {repliedContacts} replied</span>}
        </span>
        {application.last_activity && (
          <span className="truncate" title={application.last_activity.message}>
            {formatRelative(application.last_activity.created_at)}
          </span>
        )}
      </div>

      {application.next_step && (
        <p
          className={`mt-2 flex items-center gap-1.5 text-xs truncate ${overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}`}
          title={application.next_step}
        >
          <CalendarClock className="w-3 h-3 shrink-0" />
          <span className="truncate">
            {application.next_step}
            {application.next_step_at && ` · ${overdue ? 'overdue' : formatRelative(application.next_step_at)}`}
          </span>
        </p>
      )}

      {/* Stage select: keyboard / touch alternative to drag-and-drop */}
      <select
        value={application.stage}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onStageChange(e.target.value as Stage)}
        aria-label="Move to stage"
        className="mt-3 w-full text-xs rounded-md border border-border bg-background px-2 py-1 text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {STAGE_LABELS[stage]}
          </option>
        ))}
      </select>
    </div>
  )
}
