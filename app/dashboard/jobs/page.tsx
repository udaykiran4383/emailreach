'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
  Briefcase,
  Loader2,
  Info,
  Square,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  UserSearch,
  Link2,
  MapPin,
  AlertTriangle,
  Download,
} from 'lucide-react'
import type { ScoredJob, Seniority } from '@/lib/jobs/index'

interface CompanyJobs {
  company: string
  domain: string
  provider: 'greenhouse' | 'lever' | 'ashby' | null
  boardToken: string | null
  totalJobs: number
  jobs: ScoredJob[]
  error?: string
}

interface CampaignOption {
  id: string
  name: string
}

const MAX_COMPANIES = 50

const SENIORITY_OPTIONS: { id: Seniority; label: string }[] = [
  { id: 'intern', label: 'Intern' },
  { id: 'new_grad', label: 'New grad' },
  { id: 'junior', label: 'Junior' },
  { id: 'mid', label: 'Mid' },
  { id: 'senior', label: 'Senior+' },
]

const PROVIDER_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
}

const FREE_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'protonmail.com', 'proton.me', 'rediffmail.com', 'aol.com', 'zoho.com',
])

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function scoreColor(score: number) {
  if (score >= 70) return 'bg-green-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-muted-foreground/40'
}

export default function JobsPage() {
  const [companiesText, setCompaniesText] = useState('')
  const [keywords, setKeywords] = useState('')
  const [seniority, setSeniority] = useState<Set<Seniority>>(new Set())
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [location, setLocation] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current?: string } | null>(null)
  const [results, setResults] = useState<CompanyJobs[]>([])
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [sourceCampaignId, setSourceCampaignId] = useState('')
  const [targetCampaignId, setTargetCampaignId] = useState('')
  const [tracked, setTracked] = useState<Set<string>>(new Set())
  const [busyJob, setBusyJob] = useState<string | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    fetch('/api/campaigns')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCampaigns(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => setCampaigns([]))
    return () => {
      cancelRef.current = true
    }
  }, [])

  const jobKey = (job: ScoredJob) => `${job.provider}:${job.id}`

  const toggleSeniority = (level: Seniority) => {
    setSeniority((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const loadFromCampaign = async (campaignId: string) => {
    setSourceCampaignId(campaignId)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients`)
      if (!res.ok) throw new Error('Failed to load recipients')
      const recipients: Array<{ email: string }> = await res.json()
      const domains = Array.from(
        new Set(
          recipients
            .map((r) => r.email?.toLowerCase().split('@')[1])
            .filter((d): d is string => !!d && !FREE_PROVIDERS.has(d))
        )
      ).slice(0, MAX_COMPANIES)
      if (domains.length === 0) {
        toast.info('No company domains in that campaign (personal addresses are skipped)')
        return
      }
      setCompaniesText(domains.join('\n'))
      toast.success(`Loaded ${domains.length} company domain${domains.length === 1 ? '' : 's'}`)
    } catch (err: any) {
      toast.error(err.message || 'Failed to load campaign')
    }
  }

  const handleSearch = async () => {
    const companies = Array.from(new Set(companiesText.split(/\n/).map((c) => c.trim()).filter(Boolean)))
    if (companies.length === 0) {
      toast.error('Add at least one company domain')
      return
    }
    if (companies.length > MAX_COMPANIES) {
      toast.error(`Max ${MAX_COMPANIES} companies at a time`)
      return
    }

    cancelRef.current = false
    setRunning(true)
    setResults([])
    setProgress({ done: 0, total: companies.length })

    let found = 0
    // One company per request keeps each call inside serverless time limits
    for (let i = 0; i < companies.length; i++) {
      if (cancelRef.current) break
      setProgress({ done: i, total: companies.length, current: companies[i] })
      try {
        const res = await fetch('/api/jobs/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companies: [companies[i]],
            keywords,
            seniority: Array.from(seniority),
            remoteOnly,
            location,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Request failed')
        const batch: CompanyJobs[] = data.results || []
        found += batch.reduce((n, r) => n + r.jobs.length, 0)
        setResults((prev) =>
          [...prev, ...batch].sort((a, b) => (b.jobs[0]?.score ?? -1) - (a.jobs[0]?.score ?? -1))
        )
      } catch (err: any) {
        setResults((prev) => [
          ...prev,
          {
            company: companies[i],
            domain: companies[i],
            provider: null,
            boardToken: null,
            totalJobs: 0,
            jobs: [],
            error: err.message || 'Request failed',
          },
        ])
      }
    }

    const stopped = cancelRef.current
    setProgress((p) => (p ? { done: stopped ? p.done : p.total, total: p.total } : null))
    setRunning(false)
    if (stopped) toast.info(`Stopped. Found ${found} matching job${found === 1 ? '' : 's'} so far.`)
    else if (found === 0) toast.info('No matching open roles found')
    else toast.success(`Found ${found} matching job${found === 1 ? '' : 's'}`)
  }

  const handleTrack = async (job: ScoredJob, domain: string) => {
    setBusyJob(jobKey(job))
    try {
      const res = await fetch('/api/jobs/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, domain }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save job')
      setTracked((prev) => new Set(prev).add(jobKey(job)))
      if (data.pipelineError) toast.warning(`Saved, but not added to pipeline: ${data.pipelineError}`)
      else toast.success('Saved and added to your pipeline')
    } catch (err: any) {
      toast.error(err.message || 'Failed to save job')
    } finally {
      setBusyJob(null)
    }
  }

  const handleAttach = async (job: ScoredJob, domain: string) => {
    if (!targetCampaignId) {
      toast.error('Pick a campaign to attach jobs to (above the results)')
      return
    }
    setBusyJob(jobKey(job))
    try {
      const res = await fetch('/api/jobs/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: targetCampaignId, domain, job }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to attach job')
      if (data.updated === 0) {
        toast.info(`No recipients from ${domain} in that campaign yet — find contacts first`)
      } else {
        toast.success(`Added job to ${data.updated} recipient${data.updated === 1 ? '' : 's'} at ${domain}`, {
          description: 'Use {{job_title}}, {{job_url}} and {{job_location}} in your template',
        })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to attach job')
    } finally {
      setBusyJob(null)
    }
  }

  const handleDownload = () => {
    const rows = results.flatMap((r) => r.jobs.map((j) => ({ ...j, domain: r.domain })))
    if (rows.length === 0) return
    const header = 'company,domain,title,location,remote,score,url,posted_at'
    const lines = rows.map((j) =>
      [j.company, j.domain, j.title, j.location, j.remote ? 'yes' : 'no', String(j.score), j.url, j.postedAt || '']
        .map((v) => csvEscape(v || ''))
        .join(',')
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'open-roles.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalJobs = results.reduce((n, r) => n + r.jobs.length, 0)

  return (
    <div className="flex flex-col gap-8 py-8 animate-enter">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Briefcase className="w-7 h-7 text-primary" />
          Hiring Now
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Find open roles at your target companies and mention the exact job in your email.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="text-muted-foreground space-y-1">
          <p>
            Reads public job boards on Greenhouse, Lever and Ashby (no API keys). Companies on other systems (Workday,
            in-house careers pages) won&apos;t show up.
          </p>
          <p>
            Emails that name a real opening get far more replies. Attach a job to a campaign, then use{' '}
            <code className="px-1 rounded bg-muted text-foreground">{'{{job_title}}'}</code> and{' '}
            <code className="px-1 rounded bg-muted text-foreground">{'{{job_url}}'}</code> in your template.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <Label htmlFor="companies" className="font-semibold">
            Company domains (one per line, max {MAX_COMPANIES})
          </Label>
          <Textarea
            id="companies"
            value={companiesText}
            onChange={(e) => setCompaniesText(e.target.value)}
            placeholder={'razorpay.com\npostman.com\nnotion.so'}
            className="min-h-[160px] font-mono text-xs"
            disabled={running}
          />
          {campaigns.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-sm text-muted-foreground shrink-0">Or load companies from</span>
              <Select value={sourceCampaignId} onValueChange={loadFromCampaign} disabled={running}>
                <SelectTrigger className="sm:w-[240px]">
                  <SelectValue placeholder="a campaign's recipients" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="keywords" className="font-semibold">
              Role keywords &amp; skills
            </Label>
            <Input
              id="keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="backend engineer, node, react, python"
              disabled={running}
            />
            <p className="text-xs text-muted-foreground">Comma-separated. Title matches count more than description matches.</p>
          </div>
          <div className="space-y-2">
            <Label className="font-semibold">Seniority (none = any)</Label>
            <div className="flex flex-wrap gap-2">
              {SENIORITY_OPTIONS.map((s) => {
                const active = seniority.has(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSeniority(s.id)}
                    disabled={running}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground'
                      }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={remoteOnly} onCheckedChange={(v) => setRemoteOnly(v === true)} disabled={running} />
              Remote only
            </label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location filter, e.g. Bengaluru"
              className="sm:max-w-[240px]"
              disabled={running}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSearch} disabled={running} size="lg">
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Briefcase className="w-4 h-4 mr-2" />}
          {running ? 'Searching…' : 'Find open roles'}
        </Button>
        {running && (
          <Button variant="outline" size="lg" onClick={() => (cancelRef.current = true)}>
            <Square className="w-4 h-4 mr-2" />
            Stop
          </Button>
        )}
        {progress && (
          <p className="text-sm text-muted-foreground">
            {progress.done} / {progress.total} companies
            {running && progress.current ? ` · checking ${progress.current}…` : ''}
          </p>
        )}
      </div>

      {results.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {totalJobs} matching role{totalJobs === 1 ? '' : 's'} across {results.filter((r) => r.jobs.length).length}{' '}
            compan{results.filter((r) => r.jobs.length).length === 1 ? 'y' : 'ies'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={targetCampaignId} onValueChange={setTargetCampaignId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Campaign to attach jobs to" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleDownload} disabled={totalJobs === 0}>
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {results.map((r, i) => (
          <div key={`${r.domain}-${i}`} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-foreground">{r.company}</h3>
                <p className="text-xs text-muted-foreground">
                  {r.domain}
                  {r.provider && ` · ${PROVIDER_LABELS[r.provider]} board "${r.boardToken}"`}
                  {r.provider && ` · ${r.jobs.length} of ${r.totalJobs} open roles match`}
                </p>
              </div>
              <Link
                href={`/dashboard/find-contacts?companies=${encodeURIComponent(r.domain)}&roles=hr,tech_lead`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <UserSearch className="w-4 h-4" />
                Find HR &amp; tech leads
              </Link>
            </div>

            {r.error && r.jobs.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                {r.error}
              </p>
            ) : r.jobs.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                {r.totalJobs} open role{r.totalJobs === 1 ? '' : 's'}, none matching your filters.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {r.jobs.map((job) => {
                  const key = jobKey(job)
                  const isTracked = tracked.has(key)
                  const busy = busyJob === key
                  return (
                    <li key={key} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{job.title}</p>
                        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                          {job.location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {job.location}
                            </span>
                          )}
                          {job.remote && <span className="text-green-600 dark:text-green-400">Remote</span>}
                          {job.department && <span>{job.department}</span>}
                          {job.postedAt && <span>Posted {new Date(job.postedAt).toLocaleDateString()}</span>}
                        </p>
                        <div className="mt-2 flex items-center gap-2" title={`Match score ${job.score}/100`}>
                          <div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full ${scoreColor(job.score)}`} style={{ width: `${job.score}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{job.score}% match</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {job.url && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={job.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4 mr-1" />
                              Open
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTrack(job, r.domain)}
                          disabled={busy || isTracked}
                        >
                          {isTracked ? <BookmarkCheck className="w-4 h-4 mr-1" /> : <Bookmark className="w-4 h-4 mr-1" />}
                          {isTracked ? 'Tracked' : 'Track'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleAttach(job, r.domain)} disabled={busy}>
                          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />}
                          Add to campaign
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
