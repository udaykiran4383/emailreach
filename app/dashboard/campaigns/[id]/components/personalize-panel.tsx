'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Sparkles, Loader2, Info, Square, Save, RefreshCw } from 'lucide-react'

interface RecipientRow {
  id: string
  email: string
  name?: string
  company?: string
  status: string
  variables?: Record<string, any> | null
}

const CONFIDENCE_BADGES: Record<string, string> = {
  high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  low: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  manual: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export default function PersonalizePanel({ campaignId }: { campaignId: string }) {
  const [recipients, setRecipients] = useState<RecipientRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [savingId, setSavingId] = useState<string | null>(null)
  const stopRef = useRef(false)

  useEffect(() => {
    fetchRecipients()
    return () => {
      stopRef.current = true
    }
  }, [campaignId])

  const fetchRecipients = async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients?t=${Date.now()}`, { cache: 'no-store' })
      if (res.ok) {
        const data: RecipientRow[] = await res.json()
        setRecipients(data.filter(r => r.status === 'pending'))
        setDrafts({})
      }
    } finally {
      setLoading(false)
    }
  }

  const callApi = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/campaigns/${campaignId}/personalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  const generate = async (overwrite = false) => {
    stopRef.current = false
    setGenerating(true)
    const total = overwrite
      ? recipients.length
      : recipients.filter(r => !r.variables?.opener_confidence).length
    setProgress({ done: 0, total })
    let done = 0
    try {
      // overwrite only applies to the first pass; later passes pick up the rest
      let first = true
      while (!stopRef.current) {
        const data = await callApi({
          action: 'generate',
          overwrite: overwrite && first,
          recipientIds: overwrite && first ? recipients.map(r => r.id) : undefined,
        })
        first = false
        done += data.done
        setProgress({ done, total: Math.max(total, done + data.remaining) })
        if (data.errors?.length) console.warn('Opener errors:', data.errors)
        if (data.remaining <= 0 || data.done === 0) break
      }
      toast.success(stopRef.current ? `Stopped after ${done} openers` : `Generated ${done} openers`, {
        description: 'Review each one, edit if needed, and approve it.',
      })
    } catch (err: any) {
      if (err.message === 'AI_DISABLED') {
        toast.error('AI is not set up', { description: 'Add ANTHROPIC_API_KEY to .env.local and restart the app.' })
      } else {
        toast.error(`Generation failed: ${err.message}`)
      }
    } finally {
      setGenerating(false)
      fetchRecipients()
    }
  }

  const saveOpener = async (r: RecipientRow) => {
    setSavingId(r.id)
    try {
      const data = await callApi({ action: 'save', recipientId: r.id, opener: drafts[r.id] ?? r.variables?.opener_draft ?? '', approved: true })
      setRecipients(prev => prev.map(x => (x.id === r.id ? { ...x, variables: data.variables } : x)))
      setDrafts(prev => {
        const next = { ...prev }
        delete next[r.id]
        return next
      })
      toast.success('Opener saved and approved')
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`)
    } finally {
      setSavingId(null)
    }
  }

  const setApproved = async (r: RecipientRow, approved: boolean) => {
    try {
      const data = await callApi({ action: 'approve', recipientId: r.id, approved })
      setRecipients(prev => prev.map(x => (x.id === r.id ? { ...x, variables: data.variables } : x)))
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`)
    }
  }

  const approveAllHigh = async () => {
    setGenerating(true)
    try {
      const data = await callApi({ action: 'approve_all', confidence: ['high'] })
      toast.success(`Approved ${data.approved} high-confidence openers`)
    } catch (err: any) {
      toast.error(`Approve failed: ${err.message}`)
    } finally {
      setGenerating(false)
      fetchRecipients()
    }
  }

  const withOpener = recipients.filter(r => r.variables?.opener_draft)
  const highUnapproved = recipients.filter(
    r => r.variables?.opener_confidence === 'high' && r.variables?.opener_draft && !r.variables?.opener_approved
  ).length
  const approvedCount = recipients.filter(r => r.variables?.opener_approved).length

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-lg gradient-primary">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">AI opening lines</h3>
            <p className="text-sm text-muted-foreground">
              Claude reads each company's website and writes one specific first line per recipient. You review and approve before anything is sent.
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4 rounded-lg bg-muted/50 border border-border text-sm mb-4">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <div className="space-y-1 text-muted-foreground">
            <p>
              Put <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono">{'{{opener}}'}</code> in your template, e.g.{' '}
              <span className="italic">"Hi {'{{name}}'}, {'{{opener}}'} I'm a final-year CS student…"</span>
            </p>
            <p>
              Recipients without an approved opener are sent with an empty <code className="font-mono">{'{{opener}}'}</code>, so write the template so it still reads well without it.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => generate(false)} disabled={generating || loading} className="gradient-primary text-white hover:opacity-90">
            {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate openers
          </Button>
          <Button variant="outline" onClick={() => generate(true)} disabled={generating || loading || recipients.length === 0}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Regenerate all
          </Button>
          {highUnapproved > 0 && (
            <Button variant="outline" onClick={approveAllHigh} disabled={generating || loading}>
              <Save className="w-4 h-4 mr-2" />
              Approve all high-confidence ({highUnapproved})
            </Button>
          )}
          {generating && (
            <Button variant="ghost" onClick={() => (stopRef.current = true)}>
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
          <span className="text-sm text-muted-foreground ml-auto">
            {withOpener.length} with opener · {approvedCount} approved · {recipients.length} pending recipients
          </span>
        </div>

        {generating && progress.total > 0 && (
          <div className="mt-4 space-y-1">
            <Progress value={(progress.done / progress.total) * 100} />
            <p className="text-xs text-muted-foreground">
              {progress.done} / {progress.total} recipients
            </p>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[220px]">Recipient</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Opener</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[110px]">Confidence</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Approved</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
                    Loading recipients...
                  </td>
                </tr>
              ) : recipients.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    No pending recipients. Openers are only generated for emails that haven't been sent yet.
                  </td>
                </tr>
              ) : (
                recipients.map(r => {
                  // The editable draft; it only becomes {{opener}} once approved
                  const opener: string = r.variables?.opener_draft ?? ''
                  const draft = drafts[r.id]
                  const confidence: string | undefined = r.variables?.opener_confidence
                  const dirty = draft !== undefined && draft !== opener
                  return (
                    <tr key={r.id} className="border-b border-border align-top">
                      <td className="px-4 py-3 text-sm">
                        <p className="font-medium text-foreground">{r.name || '—'}</p>
                        <p className="text-muted-foreground text-xs break-all">{r.email}</p>
                        {r.company && <p className="text-muted-foreground text-xs">{r.company}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Textarea
                          value={draft ?? opener}
                          placeholder={confidence === 'failed' ? 'Generation failed. Write one yourself or regenerate.' : 'No opener yet'}
                          onChange={e => setDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
                          className="min-h-[64px] text-sm resize-y"
                        />
                        {r.variables?.opener_basis && !dirty && (
                          <p className="text-[11px] text-muted-foreground mt-1">Based on: {r.variables.opener_basis}</p>
                        )}
                        {dirty && (
                          <Button size="sm" className="mt-2" onClick={() => saveOpener(r)} disabled={savingId === r.id}>
                            {savingId === r.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                            Save &amp; approve
                          </Button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {confidence ? (
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${CONFIDENCE_BADGES[confidence] || 'bg-muted text-muted-foreground'}`}>
                            {confidence}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={Boolean(r.variables?.opener_approved)}
                          disabled={!opener || dirty}
                          onCheckedChange={v => setApproved(r, v === true)}
                          aria-label={`Approve opener for ${r.email}`}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
