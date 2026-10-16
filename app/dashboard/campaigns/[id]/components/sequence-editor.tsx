'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Save,
  Send,
  Trash2,
} from 'lucide-react'

interface EditableStep {
  key: string
  delay_days: number
  inThread: boolean
  subject: string
  body: string
}

interface StepStats {
  sentPerStep: Record<number, number>
  stopped: number
}

const MAX_FOLLOW_UPS = 4 // steps 2..5
const VARIABLE_HINTS = ['{{first_name}}', '{{company}}', '{{job_title}}', '{{opener}}']

let keyCounter = 0
const newKey = () => `step-${++keyCounter}`

function toEditable(step: { delay_days: number; subject: string | null; body: string }): EditableStep {
  return {
    key: newKey(),
    delay_days: step.delay_days,
    inThread: !step.subject,
    subject: step.subject || '',
    body: step.body,
  }
}

export default function SequenceEditor({
  campaignId,
  subject,
  body,
  autoFollowUp,
  onAutoFollowUpChange,
  sending,
  onSendDue,
  onSendNextNow,
}: {
  campaignId: string
  subject: string
  body: string
  autoFollowUp: boolean
  onAutoFollowUpChange: (value: boolean) => void
  sending: boolean
  onSendDue: () => void
  onSendNextNow: () => void
}) {
  const [steps, setSteps] = useState<EditableStep[]>([])
  const [stats, setStats] = useState<StepStats>({ sentPerStep: {}, stopped: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    loadSteps()
  }, [campaignId])

  const applyResponse = (data: any) => {
    setSteps((data.steps || []).map(toEditable))
    setStats(data.stats || { sentPerStep: {}, stopped: 0 })
    setDirty(false)
  }

  const loadSteps = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load steps')
      applyResponse(data)
      setLoadError(null)
    } catch (e: any) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const update = (key: string, patch: Partial<EditableStep>) => {
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  const addStep = () => {
    if (steps.length >= MAX_FOLLOW_UPS) return
    setSteps(prev => [
      ...prev,
      {
        key: newKey(),
        delay_days: prev.length === 0 ? 4 : 5,
        inThread: true,
        subject: '',
        body: prev.length === 0
          ? 'Hi {{first_name}},\n\nJust bumping this up in case it got buried. Happy to share more details if useful.\n\nThanks,'
          : 'Hi {{first_name}},\n\nI know you are busy, so this is my last note. If {{company}} is hiring for this later, I would love to be considered.\n\nThanks,',
      },
    ])
    setDirty(true)
  }

  const removeStep = (key: string) => {
    setSteps(prev => prev.filter(s => s.key !== key))
    setDirty(true)
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps(prev => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: steps.map(s => ({
            delay_days: s.delay_days,
            subject: s.inThread ? null : s.subject,
            body: s.body,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      applyResponse(data)
      toast.success('Sequence saved')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const insertVariable = (key: string, variable: string) => {
    const step = steps.find(s => s.key === key)
    if (step) update(key, { body: `${step.body}${step.body.endsWith(' ') || !step.body ? '' : ' '}${variable}` })
  }

  // Cumulative day each step goes out, counted from the first email
  let day = 0

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg gradient-primary">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Sequence</h3>
            <p className="text-sm text-muted-foreground">
              Follow-ups go only to people who haven&apos;t replied. A sequence stops for everyone at a company
              as soon as one person there replies.
            </p>
          </div>
        </div>
        {stats.stopped > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {stats.stopped} recipient{stats.stopped === 1 ? '' : 's'} stopped early (colleague replied, bounced or unsubscribed).
          </p>
        )}
      </div>

      {/* Step 1: the campaign's main email, edited elsewhere */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 font-medium">
            <Mail className="w-4 h-4 text-primary" />
            Step 1 · Day 0 · First email
          </div>
          <span className="text-xs text-muted-foreground">Sent: {stats.sentPerStep[1] || 0}</span>
        </div>
        <p className="text-sm font-medium text-foreground mb-1 break-words">{subject}</p>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4 break-words">{body}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading steps...
        </div>
      ) : loadError ? (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl p-4 text-sm">
          {loadError}
        </div>
      ) : (
        steps.map((step, index) => {
          day += step.delay_days
          const stepNumber = index + 2
          return (
            <div key={step.key} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <Clock className="w-4 h-4 text-primary" />
                  Step {stepNumber} · Day {day}
                  <span className="text-xs font-normal text-muted-foreground">
                    Sent: {stats.sentPerStep[stepNumber] || 0}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label="Move down">
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => removeStep(step.key)} aria-label="Remove step">
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Wait</span>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={step.delay_days}
                  onChange={(e) => update(step.key, { delay_days: Number(e.target.value) })}
                  className="w-20 h-8"
                />
                <span>days after the previous email</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Switch
                  id={`thread-${step.key}`}
                  checked={step.inThread}
                  onCheckedChange={(value) => update(step.key, { inThread: value })}
                />
                <label htmlFor={`thread-${step.key}`}>Reply in the same thread (Re: {subject})</label>
              </div>
              {!step.inThread && (
                <Input
                  value={step.subject}
                  onChange={(e) => update(step.key, { subject: e.target.value })}
                  placeholder="New subject"
                />
              )}

              <Textarea
                value={step.body}
                onChange={(e) => update(step.key, { body: e.target.value })}
                className="min-h-[140px] resize-y"
              />
              <div className="flex flex-wrap gap-1.5">
                {VARIABLE_HINTS.map(variable => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => insertVariable(step.key, variable)}
                    className="px-2 py-0.5 rounded bg-muted text-primary font-mono text-xs hover:bg-muted/70"
                  >
                    {variable}
                  </button>
                ))}
              </div>
            </div>
          )
        })
      )}

      {!loading && !loadError && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={addStep} disabled={steps.length >= MAX_FOLLOW_UPS}>
              <Plus className="w-4 h-4 mr-2" />
              Add follow-up step
            </Button>
            <Button onClick={save} disabled={saving || !dirty} className="gradient-primary text-white hover:opacity-90">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {dirty ? 'Save sequence' : 'Saved'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Switch id="auto-follow-up" checked={autoFollowUp} onCheckedChange={onAutoFollowUpChange} />
            <label htmlFor="auto-follow-up">Send due steps automatically (background scheduler)</label>
            <span className="text-xs text-muted-foreground w-full">
              Uses the same daily limit, random gaps and sending hours as first emails.
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onSendDue} disabled={sending || dirty || steps.length === 0}>
              <Send className="w-4 h-4 mr-2" />
              {sending ? 'Sending...' : 'Send due steps now'}
            </Button>
            <Button variant="outline" onClick={onSendNextNow} disabled={sending || dirty || steps.length === 0}>
              Send next step to everyone now
            </Button>
          </div>
          {dirty && <p className="text-xs text-amber-600">Save the sequence before sending.</p>}
        </div>
      )}
    </div>
  )
}
