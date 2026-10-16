'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Trash2,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Users,
  ArrowLeft,
  Square,
  Inbox,
  MailX,
  RefreshCw,
  BellOff,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'

interface PresetResult {
  id: string
  label: string
  description: string
  query: string
  estimate: number | null
  error?: string
}

interface Sender {
  email: string
  name: string
  count: number
  hasListUnsubscribe: boolean
  unsubscribeMethod?: 'one-click' | 'mailto' | 'manual' | 'none'
  lastDate: string | null
}

interface UnsubscribeResult {
  email: string
  method: 'one-click' | 'mailto' | 'manual' | 'none'
  ok: boolean
  url?: string
  error?: string
}

const UNSUBSCRIBE_LABELS: Record<string, string> = {
  'one-click': 'One-click',
  mailto: 'By email',
  manual: 'Link',
}

interface TrashTarget {
  title: string
  presetId?: string
  senders?: string[]
  age?: string
  estimate: number | null
  queryPreview: string
  /** Unsubscribe from these senders before trashing their mail */
  unsubscribeFirst?: boolean
}

const AGE_OPTIONS = [
  { value: 'any', label: 'Any age' },
  { value: '1m', label: 'Older than 1 month' },
  { value: '3m', label: 'Older than 3 months' },
  { value: '6m', label: 'Older than 6 months' },
  { value: '1y', label: 'Older than 1 year' },
  { value: '2y', label: 'Older than 2 years' },
]

class ReconnectRequired extends Error {}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (data?.error === 'RECONNECT_REQUIRED') throw new ReconnectRequired()
  if (!res.ok) throw new Error(data?.message || data?.error || `Request failed (${res.status})`)
  return data
}

export default function CleanupPage() {
  const [age, setAge] = useState('any')
  const [scanning, setScanning] = useState(false)
  const [presets, setPresets] = useState<PresetResult[] | null>(null)
  const [messagesTotal, setMessagesTotal] = useState<number | null>(null)
  const [protectedCount, setProtectedCount] = useState(0)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [notConnected, setNotConnected] = useState(false)

  const [sendersFor, setSendersFor] = useState<PresetResult | null>(null)
  const [senders, setSenders] = useState<Sender[]>([])
  const [sendersMeta, setSendersMeta] = useState<{ sampled: number; estimatedTotal: number; truncated: boolean } | null>(null)
  const [loadingSenders, setLoadingSenders] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [confirmTarget, setConfirmTarget] = useState<TrashTarget | null>(null)
  const [trashing, setTrashing] = useState(false)
  const [trashedSoFar, setTrashedSoFar] = useState(0)
  const [trashGoal, setTrashGoal] = useState<number | null>(null)
  const stopRef = useRef(false)

  const [unsubResults, setUnsubResults] = useState<Record<string, UnsubscribeResult>>({})
  const [unsubscribing, setUnsubscribing] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/gmail/cleanup/scan')
      .then((r) => r.json())
      .then((d) => {
        if (d.connected === false) setNotConnected(true)
        else if (d.hasModifyScope === false) setNeedsReconnect(true)
      })
      .catch(() => {})
  }, [])

  const handleError = (err: unknown, fallback: string) => {
    if (err instanceof ReconnectRequired) {
      setNeedsReconnect(true)
      toast.error('Reconnect Gmail to allow inbox cleanup')
      return
    }
    toast.error(err instanceof Error ? err.message : fallback)
  }

  const scan = async () => {
    setScanning(true)
    try {
      const data = await postJson('/api/gmail/cleanup/scan', { age })
      setPresets(data.presets)
      setMessagesTotal(data.messagesTotal)
      setProtectedCount(data.protectedCount || 0)
      setNeedsReconnect(false)
    } catch (err) {
      handleError(err, 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const reviewSenders = async (preset: PresetResult) => {
    setSendersFor(preset)
    setSenders([])
    setSelected(new Set())
    setSendersMeta(null)
    setLoadingSenders(true)
    try {
      const data = await postJson('/api/gmail/cleanup/senders', { presetId: preset.id, age, sample: 500 })
      setSenders(data.senders)
      setSendersMeta({ sampled: data.sampled, estimatedTotal: data.estimatedTotal, truncated: data.truncated })
    } catch (err) {
      handleError(err, 'Could not load senders')
    } finally {
      setLoadingSenders(false)
    }
  }

  /** Unsubscribes in batches of 25; returns the per-sender results. */
  const unsubscribe = async (emails: string[]): Promise<UnsubscribeResult[]> => {
    setUnsubscribing((prev) => new Set([...prev, ...emails]))
    const all: UnsubscribeResult[] = []
    try {
      for (let i = 0; i < emails.length; i += 25) {
        const data = await postJson('/api/gmail/cleanup/unsubscribe', { senders: emails.slice(i, i + 25) })
        all.push(...data.results)
        setUnsubResults((prev) => {
          const next = { ...prev }
          for (const r of data.results as UnsubscribeResult[]) next[r.email] = r
          return next
        })
      }
      const done = all.filter((r) => r.ok).length
      const manual = all.filter((r) => !r.ok && r.url).length
      if (done > 0) toast.success(`Unsubscribed from ${done} sender${done === 1 ? '' : 's'}`)
      if (manual > 0) toast.info(`${manual} sender${manual === 1 ? ' needs' : 's need'} you to open their unsubscribe page`, {
        description: 'Use the “Open page” links in the table.',
      })
      const failed = all.filter((r) => !r.ok && !r.url).length
      if (failed > 0) toast.error(`${failed} sender${failed === 1 ? '' : 's'} couldn’t be unsubscribed automatically`)
    } catch (err) {
      handleError(err, 'Unsubscribe failed')
    } finally {
      setUnsubscribing((prev) => {
        const next = new Set(prev)
        emails.forEach((e) => next.delete(e))
        return next
      })
    }
    return all
  }

  const runTrash = async (target: TrashTarget) => {
    stopRef.current = false
    setTrashing(true)
    setTrashedSoFar(0)
    setTrashGoal(target.estimate)
    let total = 0
    let queries: string[] = []
    try {
      while (!stopRef.current) {
        const data = await postJson('/api/gmail/cleanup/trash', {
          presetId: target.presetId,
          senders: target.senders,
          age: target.age,
        })
        total += data.trashed
        queries = data.queries || queries
        setTrashedSoFar(total)
        if (!data.remaining) break
      }

      const undoQueries = queries
      toast.success(`Moved ${total.toLocaleString()} emails to Trash`, {
        description: 'Gmail deletes them permanently after 30 days.',
        duration: 15000,
        action: total > 0 ? {
          label: 'Undo',
          onClick: () => restore(undoQueries),
        } : undefined,
      })
      if (sendersFor && target.senders) {
        setSenders((prev) => prev.filter((s) => !target.senders!.includes(s.email)))
        setSelected(new Set())
      }
      scan()
    } catch (err) {
      handleError(err, 'Cleanup failed')
      if (total > 0) toast.info(`${total.toLocaleString()} emails were moved to Trash before the error`)
    } finally {
      setTrashing(false)
    }
  }

  const restore = async (queries: string[]) => {
    const toastId = toast.loading('Restoring from Trash...')
    let restored = 0
    try {
      for (let i = 0; i < 100; i++) {
        const data = await postJson('/api/gmail/cleanup/restore', { queries })
        restored += data.restored
        if (!data.remaining) break
      }
      toast.success(`Restored ${restored.toLocaleString()} emails to your inbox`, { id: toastId })
      scan()
    } catch (err) {
      toast.dismiss(toastId)
      handleError(err, 'Restore failed')
    }
  }

  const largestEstimate = useMemo(
    () => Math.max(0, ...(presets || []).map((p) => p.estimate || 0)),
    [presets]
  )

  const toggleSender = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  const allSelected = senders.length > 0 && selected.size === senders.length

  return (
    <div className="flex flex-col gap-6 py-8 animate-enter">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Trash2 className="w-7 h-7 text-primary" />
            Inbox Cleanup
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Clear out old marketing, newsletters and notifications in bulk.
            {messagesTotal !== null && (
              <span className="ml-1 text-foreground font-medium">
                {messagesTotal.toLocaleString()} emails in your mailbox.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={age}
            onValueChange={(value) => {
              // Counts and queries depend on the age filter, so force a rescan
              setAge(value)
              setPresets(null)
              setSendersFor(null)
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={scan} disabled={scanning || trashing || notConnected}>
            {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-2" />}
            {presets ? 'Rescan' : 'Scan mailbox'}
          </Button>
        </div>
      </div>

      {/* Connection problems */}
      {notConnected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-200">Connect your Gmail account first.</p>
          <Button size="sm" onClick={() => { window.location.href = '/api/gmail/auth' }}>Connect Gmail</Button>
        </div>
      )}
      {needsReconnect && !notConnected && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Cleanup needs permission to move mail to Trash. Reconnect Gmail and approve the new access.
          </p>
          <Button size="sm" onClick={() => { window.location.href = '/api/gmail/auth' }}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Reconnect Gmail
          </Button>
        </div>
      )}

      {/* Safety callout */}
      <div className="rounded-xl border border-border bg-card p-4 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            <span className="text-foreground font-medium">Never touched:</span> starred, important, sent, drafts and chats,
            anything labelled <code className="px-1 rounded bg-muted">emailreach-keep</code>, and every campaign contact who replied to you
            {protectedCount > 0 ? ` (${protectedCount} protected addresses)` : ''}.
          </p>
          <p>
            Emails go to <span className="text-foreground font-medium">Trash</span>, not permanent deletion — you can undo for 30 days.
            Tip: paste the query from the confirmation into Gmail search to preview exactly what will be moved.
          </p>
        </div>
      </div>

      {/* Progress */}
      {trashing && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Moved {trashedSoFar.toLocaleString()}
              {trashGoal ? ` of ~${trashGoal.toLocaleString()}` : ''} emails to Trash...
            </p>
            <Button variant="outline" size="sm" onClick={() => { stopRef.current = true }}>
              <Square className="w-3.5 h-3.5 mr-2" />
              Stop
            </Button>
          </div>
          <Progress value={trashGoal ? Math.min(100, (trashedSoFar / trashGoal) * 100) : undefined} />
        </div>
      )}

      {/* Senders view */}
      {sendersFor ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setSendersFor(null)}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div>
                <h3 className="font-semibold text-foreground">Senders in {sendersFor.label}</h3>
                {sendersMeta && (
                  <p className="text-xs text-muted-foreground">
                    From a sample of {sendersMeta.sampled.toLocaleString()} of ~{sendersMeta.estimatedTotal.toLocaleString()} emails
                    {sendersMeta.truncated ? ' (partial — sample cut short)' : ''}. Trashing a sender removes all their matching mail.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={senders.length === 0}
                onClick={() => setSelected(allSelected ? new Set() : new Set(senders.map((s) => s.email)))}
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0 || trashing || unsubscribing.size > 0}
                onClick={() => {
                  const list = Array.from(selected)
                  setConfirmTarget({
                    title: `Unsubscribe from ${list.length} sender${list.length === 1 ? '' : 's'} and trash their mail?`,
                    presetId: sendersFor.id,
                    senders: list,
                    age,
                    estimate: senders.filter((s) => selected.has(s.email)).reduce((n, s) => n + s.count, 0),
                    queryPreview: `${sendersFor.query} from:(${list.slice(0, 5).join(' OR ')}${list.length > 5 ? ' OR …' : ''})`,
                    unsubscribeFirst: true,
                  })
                }}
              >
                <BellOff className="w-4 h-4 mr-2" />
                Unsubscribe & trash ({selected.size})
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={selected.size === 0 || trashing}
                onClick={() => {
                  const list = Array.from(selected)
                  setConfirmTarget({
                    title: `Trash mail from ${list.length} sender${list.length === 1 ? '' : 's'}?`,
                    presetId: sendersFor.id,
                    senders: list,
                    age,
                    estimate: senders.filter((s) => selected.has(s.email)).reduce((n, s) => n + s.count, 0),
                    queryPreview: `${sendersFor.query} from:(${list.slice(0, 5).join(' OR ')}${list.length > 5 ? ' OR …' : ''})`,
                  })
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Trash selected ({selected.size})
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 w-10" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sender</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">In sample</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Unsubscribe</th>
                </tr>
              </thead>
              <tbody>
                {loadingSenders ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                      Reading senders...
                    </td>
                  </tr>
                ) : senders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No matching emails.</td>
                  </tr>
                ) : (
                  senders.map((s) => (
                    <tr
                      key={s.email}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => toggleSender(s.email)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(s.email)} onCheckedChange={() => toggleSender(s.email)} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{s.name || s.email}</p>
                        {s.name && <p className="text-xs text-muted-foreground">{s.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold">{s.count}</td>
                      <td className="px-4 py-3">
                        {s.hasListUnsubscribe ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">
                            <MailX className="w-3 h-3" />
                            Mailing list
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {s.lastDate ? new Date(s.lastDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const result = unsubResults[s.email]
                          if (unsubscribing.has(s.email)) {
                            return <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          }
                          if (result?.ok) {
                            return (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Unsubscribed
                              </span>
                            )
                          }
                          if (result?.url) {
                            return (
                              <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                title={result.error || 'This sender only offers a web page'}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Open page
                              </a>
                            )
                          }
                          if (result) {
                            return <span className="text-xs text-red-600" title={result.error}>Not possible</span>
                          }
                          if (!s.unsubscribeMethod || s.unsubscribeMethod === 'none') {
                            return <span className="text-xs text-muted-foreground">—</span>
                          }
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => unsubscribe([s.email])}
                            >
                              <BellOff className="w-3.5 h-3.5 mr-1" />
                              {UNSUBSCRIBE_LABELS[s.unsubscribeMethod]}
                            </Button>
                          )
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : presets ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {presets.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
              <div>
                <p className="font-semibold text-foreground">{p.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
              </div>
              <p className="text-3xl font-bold text-primary">
                {p.estimate === null ? '—' : `~${p.estimate.toLocaleString()}`}
              </p>
              {p.error && <p className="text-xs text-red-600">{p.error}</p>}
              <div className="mt-auto flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!p.estimate || trashing}
                  onClick={() => reviewSenders(p)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Review senders
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!p.estimate || trashing}
                  onClick={() => setConfirmTarget({
                    title: `Move all ${p.label} to Trash?`,
                    presetId: p.id,
                    age,
                    estimate: p.estimate,
                    queryPreview: p.query,
                  })}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Move all to Trash
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 px-4 glass-panel rounded-2xl border-dashed">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <Inbox className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2 text-foreground">Scan your mailbox</h3>
          <p className="text-muted-foreground mb-6 max-w-md text-center">
            See how much promotional, social and old mail you have, then clean it by category or by sender.
          </p>
          <Button onClick={scan} disabled={scanning || notConnected}>
            {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-2" />}
            Scan mailbox
          </Button>
        </div>
      )}

      {largestEstimate > 1000 && !sendersFor && (
        <p className="text-xs text-muted-foreground">
          Counts are Gmail estimates. Large cleanups run in batches of up to 1,000 — keep this tab open until it finishes.
        </p>
      )}

      {/* Confirmation */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTarget?.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  About <span className="font-semibold text-foreground">{confirmTarget?.estimate?.toLocaleString() ?? '?'}</span> emails
                  {confirmTarget?.age && confirmTarget.age !== 'any' ? ` (older than ${confirmTarget.age})` : ''} will move to Trash.
                  You can undo right after, and Gmail keeps Trash for 30 days.
                </p>
                {confirmTarget?.unsubscribeFirst && (
                  <p>
                    First we’ll unsubscribe you from these senders: a one-click request where the sender supports it, otherwise an
                    unsubscribe email from your address. Senders that only offer a web page will show an “Open page” link instead.
                  </p>
                )}
                <div>
                  <p className="text-xs mb-1">Gmail search used (protections are added automatically):</p>
                  <code className="block w-full break-all rounded bg-muted p-2 text-xs text-foreground">
                    {confirmTarget?.queryPreview}
                  </code>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = confirmTarget
                setConfirmTarget(null)
                if (!target) return
                if (target.unsubscribeFirst && target.senders?.length) {
                  unsubscribe(target.senders).then(() => runTrash(target))
                } else {
                  runTrash(target)
                }
              }}
            >
              {confirmTarget?.unsubscribeFirst ? 'Unsubscribe & move to Trash' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
