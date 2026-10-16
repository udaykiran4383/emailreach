'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ScanSearch,
  Loader2,
  Download,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  HelpCircle,
  Info,
} from 'lucide-react'

type VerificationStatus = 'safe' | 'risky' | 'invalid'

interface ExtractedRow {
  email: string
  name: string
  company: string
  source: string
  verification?: { status: VerificationStatus; reason?: string }
}

interface CampaignOption {
  id: string
  name: string
}

const BADGES: Record<VerificationStatus | 'unknown', { label: string; icon: typeof ShieldCheck; className: string }> = {
  safe: { label: 'Safe', icon: ShieldCheck, className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  risky: { label: 'Risky', icon: ShieldAlert, className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  invalid: { label: 'Invalid', icon: ShieldX, className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  unknown: { label: 'Unverified', icon: HelpCircle, className: 'bg-muted text-muted-foreground' },
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export default function ExtractPage() {
  const [text, setText] = useState('')
  const [urlsText, setUrlsText] = useState('')
  const [crawl, setCrawl] = useState(true)
  const [verify, setVerify] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [rows, setRows] = useState<ExtractedRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [onlySafe, setOnlySafe] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [summary, setSummary] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch('/api/campaigns')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCampaigns(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => setCampaigns([]))
  }, [])

  const statusOf = (row: ExtractedRow): VerificationStatus | 'unknown' => row.verification?.status ?? 'unknown'

  const visibleRows = useMemo(
    () => (onlySafe ? rows.filter((r) => statusOf(r) === 'safe') : rows),
    [rows, onlySafe]
  )

  const counts = useMemo(() => {
    const c = { safe: 0, risky: 0, invalid: 0, unknown: 0 }
    rows.forEach((r) => c[statusOf(r)]++)
    return c
  }, [rows])

  const handleExtract = async () => {
    const urls = urlsText.split(/\s+/).map((u) => u.trim()).filter(Boolean)
    if (!text.trim() && urls.length === 0) {
      toast.error('Paste some text or add at least one URL')
      return
    }
    setExtracting(true)
    setErrors([])
    setSummary(null)
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, urls, crawl, verify }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')

      const found: ExtractedRow[] = data.emails || []
      setRows(found)
      setSelected(new Set(found.filter((r) => r.verification?.status === 'safe').map((r) => r.email)))
      setErrors(data.errors || [])
      setSummary(
        `Found ${found.length} address${found.length === 1 ? '' : 'es'}` +
          (urls.length ? ` from ${data.pagesFetched} page${data.pagesFetched === 1 ? '' : 's'}` : '') +
          (data.truncated ? ' (stopped early to stay within the time limit)' : '')
      )
      if (found.length === 0) toast.info('No email addresses found')
    } catch (err: any) {
      toast.error(err.message || 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  const updateRow = (email: string, patch: Partial<ExtractedRow>) => {
    setRows((prev) => prev.map((r) => (r.email === email ? { ...r, ...patch } : r)))
  }

  const toggle = (email: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(email)
      else next.delete(email)
      return next
    })
  }

  const selectAllSafe = () => {
    setSelected(new Set(rows.filter((r) => statusOf(r) === 'safe').map((r) => r.email)))
  }

  const selectedRows = rows.filter((r) => selected.has(r.email) && statusOf(r) !== 'invalid')

  const downloadCsv = () => {
    const list = selectedRows.length > 0 ? selectedRows : visibleRows
    if (list.length === 0) {
      toast.error('Nothing to download')
      return
    }
    const lines = ['email,name,company,verification']
    list.forEach((r) => lines.push([r.email, r.name, r.company, statusOf(r)].map(csvEscape).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `extracted-emails-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addToCampaign = async () => {
    if (!campaignId) {
      toast.error('Choose a campaign first')
      return
    }
    if (selectedRows.length === 0) {
      toast.error('Select at least one address')
      return
    }
    setAdding(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: selectedRows.map((r) => ({
            email: r.email,
            name: r.name || undefined,
            company: r.company || undefined,
            verification_status: r.verification?.status,
            verification_reason: r.verification?.reason,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add recipients')
      const extras = [
        data.duplicates ? `${data.duplicates} already in campaign` : '',
        data.blocked ? `${data.blocked} blocked (bounced/unsubscribed)` : '',
      ].filter(Boolean)
      toast.success(`Added ${data.count ?? 0} recipient${data.count === 1 ? '' : 's'}`, {
        description: extras.length ? extras.join(' · ') : undefined,
      })
    } catch (err: any) {
      toast.error(err.message || 'Failed to add recipients')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 py-8 animate-enter">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <ScanSearch className="w-7 h-7 text-primary" />
          Extract Emails
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Pull email addresses from pasted text or public web pages, verify them, and add them to a campaign.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Only extract from public pages you&apos;re allowed to use, and only contact people with a relevant, personal
          reason. Campaigns send only to addresses that verify as <strong className="text-foreground">safe</strong>;
          risky and invalid ones are skipped so bounces don&apos;t hurt your Gmail reputation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <Label htmlFor="extract-text" className="font-semibold">Paste text or HTML</Label>
          <Textarea
            id="extract-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a team page, a signature, a list of contacts, page source…"
            className="min-h-[180px] font-mono text-xs"
          />
        </div>
        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <Label htmlFor="extract-urls" className="font-semibold">Website URLs (one per line, max 20)</Label>
          <Textarea
            id="extract-urls"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={'https://company.com\nhttps://lab.university.edu/people'}
            className="min-h-[120px] font-mono text-xs"
          />
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={crawl} onCheckedChange={(v) => setCrawl(v === true)} />
              Also crawl contact / about / team pages
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={verify} onCheckedChange={(v) => setVerify(v === true)} />
              Verify mailboxes (recommended)
            </label>
          </div>
        </div>
      </div>

      <div>
        <Button onClick={handleExtract} disabled={extracting} size="lg">
          {extracting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-2" />}
          {extracting ? 'Extracting…' : 'Extract emails'}
        </Button>
        {summary && <p className="text-sm text-muted-foreground mt-3">{summary}</p>}
        {errors.length > 0 && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{errors.length} warning{errors.length === 1 ? '' : 's'}</summary>
            <ul className="mt-1 space-y-0.5 list-disc pl-5">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </details>
        )}
      </div>

      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/50 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-foreground">{rows.length} found</span>
              <span className="text-green-700 dark:text-green-400">{counts.safe} safe</span>
              <span className="text-amber-700 dark:text-amber-400">{counts.risky} risky</span>
              <span className="text-red-700 dark:text-red-400">{counts.invalid} invalid</span>
              {counts.unknown > 0 && <span className="text-muted-foreground">{counts.unknown} unverified</span>}
              <label className="flex items-center gap-2 cursor-pointer ml-2">
                <Checkbox checked={onlySafe} onCheckedChange={(v) => setOnlySafe(v === true)} />
                Only verified-safe
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAllSafe}>Select all safe</Button>
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
              <Button variant="outline" size="sm" onClick={downloadCsv}>
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </Button>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger size="sm" className="w-[200px]">
                  <SelectValue placeholder={campaigns.length ? 'Choose campaign' : 'No campaigns yet'} />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={addToCampaign} disabled={adding || selectedRows.length === 0 || !campaignId}>
                {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Add {selectedRows.length} to campaign
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 w-10" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Verification</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No verified-safe addresses. Untick &quot;Only verified-safe&quot; to see the rest.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const status = statusOf(row)
                    const badge = BADGES[status]
                    const BadgeIcon = badge.icon
                    const isInvalid = status === 'invalid'
                    return (
                      <tr key={row.email} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selected.has(row.email) && !isInvalid}
                            disabled={isInvalid}
                            onCheckedChange={(v) => toggle(row.email, v === true)}
                            aria-label={`Select ${row.email}`}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">{row.email}</td>
                        <td className="px-4 py-3">
                          <Input
                            value={row.name}
                            onChange={(e) => updateRow(row.email, { name: e.target.value })}
                            placeholder="Name"
                            className="h-8 min-w-[140px] text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            value={row.company}
                            onChange={(e) => updateRow(row.email, { company: e.target.value })}
                            placeholder="Company"
                            className="h-8 min-w-[140px] text-sm"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                            title={row.verification?.reason}
                          >
                            <BadgeIcon className="w-3 h-3" />
                            {badge.label}
                          </span>
                          {row.verification?.reason && (
                            <p className="text-[10px] text-muted-foreground mt-1 max-w-[200px] truncate" title={row.verification.reason}>
                              {row.verification.reason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate" title={row.source}>
                          {row.source}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
