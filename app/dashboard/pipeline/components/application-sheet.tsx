'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ExternalLink,
  Loader2,
  Mail,
  Save,
  Trash2,
  Eye,
  MessageCircle,
  ArrowRightLeft,
  StickyNote,
  Send,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { STAGES, STAGE_LABELS, type Stage } from '@/lib/pipeline/stages'
import { PipelineActivity, PipelineApplication, PipelineContact, STAGE_STYLES, formatRelative } from './types'

const ACTIVITY_ICONS: Record<PipelineActivity['kind'], typeof Info> = {
  stage_change: ArrowRightLeft,
  note: StickyNote,
  email_sent: Send,
  reply: MessageCircle,
  system: Info,
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ApplicationSheet({
  application,
  open,
  onOpenChange,
  onChanged,
  onDeleted,
}: {
  application: PipelineApplication | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  onDeleted: (id: string) => void
}) {
  const [activity, setActivity] = useState<PipelineActivity[]>([])
  const [contacts, setContacts] = useState<PipelineContact[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notes, setNotes] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [nextStepAt, setNextStepAt] = useState('')
  const [jobTitle, setJobTitle] = useState('')

  const applicationId = application?.id

  useEffect(() => {
    if (!application || !open) return
    setNotes(application.notes || '')
    setNextStep(application.next_step || '')
    setNextStepAt(toLocalInput(application.next_step_at))
    setJobTitle(application.job_title || '')
    setContacts(application.contacts)
    setConfirmDelete(false)
    loadDetails(application.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, open])

  const loadDetails = async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pipeline/${id}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setActivity(data.activity || [])
        setContacts(data.contacts || [])
      }
    } finally {
      setLoading(false)
    }
  }

  const patch = async (body: Record<string, unknown>, successMessage?: string) => {
    if (!application) return false
    const res = await fetch(`/api/pipeline/${application.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || 'Update failed')
      return false
    }
    if (successMessage) toast.success(successMessage)
    onChanged()
    loadDetails(application.id)
    return true
  }

  const handleSave = async () => {
    setSaving(true)
    await patch(
      {
        notes,
        next_step: nextStep,
        next_step_at: nextStepAt ? new Date(nextStepAt).toISOString() : null,
        job_title: jobTitle,
      },
      'Saved'
    )
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!application) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/pipeline/${application.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      toast.success(`${application.company} removed from pipeline`)
      onDeleted(application.id)
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setDeleting(false)
    }
  }

  if (!application) return null

  const gmailSearch = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${application.domain} OR to:${application.domain}`)}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {application.company}
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_STYLES[application.stage].badge}`}>
              {STAGE_LABELS[application.stage]}
            </span>
          </SheetTitle>
          <SheetDescription>{application.domain}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {/* Links */}
          <div className="flex flex-wrap gap-2">
            <a href={`https://${application.domain}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm"><ExternalLink className="w-3.5 h-3.5 mr-1.5" />Website</Button>
            </a>
            {application.job_url && (
              <a href={application.job_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm"><ExternalLink className="w-3.5 h-3.5 mr-1.5" />Job posting</Button>
              </a>
            )}
            <a href={gmailSearch} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm"><Mail className="w-3.5 h-3.5 mr-1.5" />Open in Gmail</Button>
            </a>
          </div>

          {/* Stage */}
          <div className="space-y-2">
            <Label>Stage</Label>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => stage !== application.stage && patch({ stage }, `Moved to ${STAGE_LABELS[stage]}`)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${stage === application.stage
                    ? `${STAGE_STYLES[stage].badge} border-transparent`
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  aria-pressed={stage === application.stage}
                >
                  {STAGE_LABELS[stage as Stage]}
                </button>
              ))}
            </div>
          </div>

          {/* Editable details */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="sheet-job-title">Job title</Label>
              <Input id="sheet-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Backend Engineer" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sheet-next-step">Next step</Label>
                <Input id="sheet-next-step" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Follow up with CTO" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sheet-next-step-at">Due</Label>
                <Input id="sheet-next-step-at" type="datetime-local" value={nextStepAt} onChange={(e) => setNextStepAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sheet-notes">Notes</Label>
              <Textarea id="sheet-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Interview prep, people you spoke to, salary range…" className="min-h-[100px]" />
            </div>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save
            </Button>
          </div>

          {/* Contacts */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Contacts ({contacts.length})</h4>
            {contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No campaign recipients at {application.domain} yet.</p>
            ) : (
              <ul className="divide-y divide-border border border-border rounded-lg">
                {contacts.map((contact) => (
                  <li key={`${contact.email}-${contact.campaign_name}`} className="p-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{contact.name || contact.email}</p>
                      <a href={`mailto:${contact.email}`} className="text-xs text-primary hover:underline break-all">{contact.email}</a>
                      {contact.campaign_name && <p className="text-[11px] text-muted-foreground truncate">{contact.campaign_name}</p>}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1 shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground capitalize">{contact.status}</span>
                      {contact.opened_at && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          <Eye className="w-3 h-3" />Opened
                        </span>
                      )}
                      {(contact.replied_at || contact.status === 'replied') && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                          <MessageCircle className="w-3 h-3" />Replied
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              Activity {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </h4>
            {activity.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-3">
                {activity.map((item) => {
                  const Icon = ACTIVITY_ICONS[item.kind] || Info
                  return (
                    <li key={item.id} className="ml-4">
                      <span className="absolute -left-2.5 flex items-center justify-center w-5 h-5 rounded-full bg-muted ring-2 ring-background">
                        <Icon className="w-3 h-3 text-muted-foreground" />
                      </span>
                      <p className="text-sm">{item.message}</p>
                      <time className="text-[11px] text-muted-foreground" title={new Date(item.created_at).toLocaleString()}>
                        {formatRelative(item.created_at)}
                      </time>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          {/* Delete */}
          <div className="pt-2 border-t border-border">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Remove from pipeline? Contacts and emails stay.</span>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Remove'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="w-4 h-4 mr-2" />Remove from pipeline
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
