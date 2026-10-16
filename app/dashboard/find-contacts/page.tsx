'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
  UserSearch,
  Loader2,
  Download,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  HelpCircle,
  Info,
  Square,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react'
import type { Contact, CompanyResult, Role } from '@/lib/email/people-finder'

type VerificationStatus = 'safe' | 'risky' | 'invalid'
type RoleFilter = Role | 'other' | 'all'

interface CampaignOption {
  id: string
  name: string
}

const MAX_COMPANIES = 50

const ROLE_OPTIONS: { id: Role; label: string }[] = [
  { id: 'hr', label: 'HR / Recruiters' },
  { id: 'tech_lead', label: 'Tech Leads' },
  { id: 'cto', label: 'CTO' },
  { id: 'ceo', label: 'CEO' },
]

const ROLE_BADGES: Record<Role | 'other', { label: string; className: string }> = {
  hr: { label: 'HR', className: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300' },
  tech_lead: { label: 'Tech Lead', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  cto: { label: 'CTO', className: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' },
  ceo: { label: 'CEO', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  other: { label: 'Other', className: 'bg-muted text-muted-foreground' },
}

const SOURCE_BADGES: Record<Contact['source'], { label: string; className: string }> = {
  website: { label: 'Website', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  pattern: { label: 'Pattern guess', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  hunter: { label: 'Hunter', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' },
}

const VERIFY_BADGES: Record<VerificationStatus | 'unknown', { label: string; icon: typeof ShieldCheck; className: string }> = {
  safe: { label: 'Safe', icon: ShieldCheck, className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  risky: { label: 'Risky', icon: ShieldAlert, className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  invalid: { label: 'Invalid', icon: ShieldX, className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  unknown: { label: 'Unverified', icon: HelpCircle, className: 'bg-muted text-muted-foreground' },
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const statusOf = (c: Contact): VerificationStatus | 'unknown' => c.verification?.status ?? 'unknown'

export default function FindContactsPage() {
  const [companiesText, setCompaniesText] = useState('')
  const [roles, setRoles] = useState<Set<Role>>(new Set(['hr', 'tech_lead', 'cto', 'ceo']))
  const [guessPatterns, setGuessPatterns] = useState(true)
  const [verify, setVerify] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current?: string } | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [companyResults, setCompanyResults] = useState<CompanyResult[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [onlySafe, setOnlySafe] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [adding, setAdding] = useState(false)
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

  // Prefill from links like /dashboard/find-contacts?companies=acme.com&roles=hr,tech_lead (e.g. from the Jobs page)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const companies = params.get('companies')
    if (companies) setCompaniesText(companies.split(',').map((c) => c.trim()).filter(Boolean).join('\n'))
    const roleParam = params.get('roles')
    if (roleParam) {
      const valid = roleParam.split(',').filter((r): r is Role => ROLE_OPTIONS.some((o) => o.id === r))
      if (valid.length) setRoles(new Set(valid))
    }
  }, [])

  const toggleRole = (role: Role) => {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  const handleFind = async () => {
    const companies = Array.from(
      new Set(companiesText.split(/\n/).map((c) => c.trim()).filter(Boolean))
    )
    if (companies.length === 0) {
      toast.error('Add at least one company website or domain')
      return
    }
    if (companies.length > MAX_COMPANIES) {
      toast.error(`Max ${MAX_COMPANIES} companies at a time`)
      return
    }
    if (roles.size === 0) {
      toast.error('Pick at least one role')
      return
    }

    cancelRef.current = false
    setRunning(true)
    setContacts([])
    setCompanyResults([])
    setSelected(new Set())
    setProgress({ done: 0, total: companies.length })

    let found = 0
    // One company per request keeps each call inside serverless time limits
    for (let i = 0; i < companies.length; i++) {
      if (cancelRef.current) break
      setProgress({ done: i, total: companies.length, current: companies[i] })
      try {
        const res = await fetch('/api/find-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companies: [companies[i]], roles: Array.from(roles), verify, guessPatterns }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Request failed')

        const newContacts: Contact[] = data.contacts || []
        found += newContacts.length
        setContacts((prev) => {
          const seen = new Set(prev.map((c) => c.email))
          return [...prev, ...newContacts.filter((c) => !seen.has(c.email))]
        })
        setSelected((prev) => {
          const next = new Set(prev)
          newContacts.filter((c) => statusOf(c) === 'safe').forEach((c) => next.add(c.email))
          return next
        })
        setCompanyResults((prev) => [...prev, ...(data.companies || [])])
      } catch (err: any) {
        setCompanyResults((prev) => [
          ...prev,
          {
            input: companies[i],
            domain: companies[i],
            company: companies[i],
            pattern: null,
            patternSource: null,
            catchAll: null,
            pagesFetched: 0,
            peopleFound: 0,
            errors: [err.message || 'Request failed'],
          },
        ])
      }
    }

    const stopped = cancelRef.current
    setProgress((p) => (p ? { done: stopped ? p.done : p.total, total: p.total } : null))
    setRunning(false)
    if (stopped) toast.info(`Stopped. Found ${found} contact${found === 1 ? '' : 's'} so far.`)
    else if (found === 0) toast.info('No contacts found for these companies')
    else toast.success(`Found ${found} contact${found === 1 ? '' : 's'}`)
  }

  const handleStop = () => {
    cancelRef.current = true
  }

  const visibleContacts = useMemo(
    () =>
      contacts.filter(
        (c) => (roleFilter === 'all' || c.role === roleFilter) && (!onlySafe || statusOf(c) === 'safe')
      ),
    [contacts, roleFilter, onlySafe]
  )

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    contacts.forEach((c) => {
      if (!onlySafe || statusOf(c) === 'safe') counts[c.role] = (counts[c.role] || 0) + 1
    })
    return counts
  }, [contacts, onlySafe])

  const verifyCounts = useMemo(() => {
    const c = { safe: 0, risky: 0, invalid: 0, unknown: 0 }
    contacts.forEach((r) => c[statusOf(r)]++)
    return c
  }, [contacts])

  const toggle = (email: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(email)
      else next.delete(email)
      return next
    })
  }

  const selectAllSafe = () => {
    setSelected(new Set(contacts.filter((c) => statusOf(c) === 'safe').map((c) => c.email)))
  }

  const selectedContacts = contacts.filter((c) => selected.has(c.email) && statusOf(c) !== 'invalid')

  const downloadCsv = () => {
    const list = selectedContacts.length > 0 ? selectedContacts : visibleContacts
    if (list.length === 0) {
      toast.error('Nothing to download')
      return
    }
    const lines = ['email,name,first_name,last_name,title,role,company,verification,source']
    list.forEach((c) =>
      lines.push(
        [c.email, c.name, c.firstName, c.lastName, c.title, c.role, c.company, statusOf(c), c.source]
          .map((v) => csvEscape(v || ''))
          .join(',')
      )
    )
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr-leaders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addToCampaign = async () => {
    if (!campaignId) {
      toast.error('Choose a campaign first')
      return
    }
    if (selectedContacts.length === 0) {
      toast.error('Select at least one contact')
      return
    }
    setAdding(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: selectedContacts.map((c) => ({
            email: c.email,
            name: c.name || undefined,
            company: c.company || undefined,
            verification_status: c.verification?.status,
            verification_reason: c.verification?.reason,
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
      const riskyCount = selectedContacts.filter((c) => statusOf(c) !== 'safe').length
      if (riskyCount > 0) {
        toast.warning(`${riskyCount} risky/unverified address${riskyCount === 1 ? '' : 'es'} added`, {
          description: 'Risky addresses are added but will be skipped at send time unless verification confirms them.',
        })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to add recipients')
    } finally {
      setAdding(false)
    }
  }

  const roleTabs: { id: RoleFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...ROLE_OPTIONS.map((r) => ({ id: r.id as RoleFilter, label: r.label })),
    { id: 'other', label: 'Other' },
  ]

  return (
    <div className="flex flex-col gap-8 py-8 animate-enter">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <UserSearch className="w-7 h-7 text-primary" />
          Find HR &amp; Leaders
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Find emails of HR / recruiters, tech leads, CTOs and CEOs at the companies you want to apply to.
        </p>
      </div>

      <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="text-muted-foreground space-y-1">
          <p>
            Uses public company pages (team, about, leadership, careers) plus Hunter.io when{' '}
            <code className="px-1 rounded bg-muted text-foreground">HUNTER_API_KEY</code> is set — never LinkedIn.
            Pattern guesses (e.g. <code className="px-1 rounded bg-muted text-foreground">first.last@company.com</code>) are
            only sent if verification confirms the mailbox, so bounces don&apos;t hurt your Gmail.
          </p>
          <p>
            Tip: personal, specific emails to <strong className="text-foreground">20–40 people a day</strong> get far more
            replies than mass blasts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <Label htmlFor="companies" className="font-semibold">
            Company websites or domains (one per line, max {MAX_COMPANIES})
          </Label>
          <Textarea
            id="companies"
            value={companiesText}
            onChange={(e) => setCompaniesText(e.target.value)}
            placeholder={'razorpay.com\nhttps://www.postman.com\nzerodha.com'}
            className="min-h-[180px] font-mono text-xs"
            disabled={running}
          />
        </div>
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="space-y-2">
            <Label className="font-semibold">Roles to find</Label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => {
                const active = roles.has(r.id)
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggleRole(r.id)}
                    disabled={running}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground'
                      }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={guessPatterns} onCheckedChange={(v) => setGuessPatterns(v === true)} disabled={running} />
              Guess emails from company pattern
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={verify} onCheckedChange={(v) => setVerify(v === true)} disabled={running} />
              Verify mailboxes (recommended)
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleFind} disabled={running} size="lg">
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserSearch className="w-4 h-4 mr-2" />}
          {running ? 'Searching…' : 'Find contacts'}
        </Button>
        {running && (
          <Button variant="outline" size="lg" onClick={handleStop}>
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

      {companyResults.length > 0 && (
        <details className="bg-card border border-border rounded-xl overflow-hidden" open={companyResults.length <= 5}>
          <summary className="px-6 py-4 cursor-pointer font-semibold text-foreground bg-muted/50">
            Company summary ({companyResults.length})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Company', 'Email pattern', 'Pages', 'People', 'Notes'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companyResults.map((r, i) => (
                  <tr key={`${r.input}-${i}`} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium text-foreground">{r.company || r.domain}</p>
                      <p className="text-xs text-muted-foreground">{r.domain}</p>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {r.pattern ? (
                        <>
                          <code className="px-1.5 py-0.5 rounded bg-muted text-primary font-mono text-xs">{r.pattern}</code>
                          {r.patternSource && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({r.patternSource === 'observed' ? 'seen on site' : 'Hunter'})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.pagesFetched}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.peopleFound}</td>
                    <td className="px-4 py-3 text-xs space-y-1 min-w-[220px]">
                      {r.catchAll && (
                        <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          Catch-all domain — guesses can&apos;t be confirmed
                        </p>
                      )}
                      {r.errors.map((e: string, j: number) => (
                        <p key={j} className="text-muted-foreground">{e}</p>
                      ))}
                      {!r.catchAll && r.errors.length === 0 && <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {contacts.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-muted/50 flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold text-foreground">{contacts.length} found</span>
                <span className="text-green-700 dark:text-green-400">{verifyCounts.safe} safe</span>
                <span className="text-amber-700 dark:text-amber-400">{verifyCounts.risky} risky</span>
                <span className="text-red-700 dark:text-red-400">{verifyCounts.invalid} invalid</span>
                {verifyCounts.unknown > 0 && <span className="text-muted-foreground">{verifyCounts.unknown} unverified</span>}
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
                <Button size="sm" onClick={addToCampaign} disabled={adding || selectedContacts.length === 0 || !campaignId}>
                  {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                  Add {selectedContacts.length} to campaign
                </Button>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto">
              {roleTabs.map((t) => {
                const count = t.id === 'all'
                  ? Object.values(roleCounts).reduce((a, b) => a + b, 0)
                  : roleCounts[t.id] || 0
                const active = roleFilter === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setRoleFilter(t.id)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                  >
                    {t.label} <span className="text-xs opacity-70">({count})</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 w-10" />
                  {['Role', 'Name', 'Title', 'Email', 'Source', 'Confidence', 'Verification', 'Company', 'Found on'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleContacts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-sm text-muted-foreground">
                      {onlySafe
                        ? 'No verified-safe contacts for this filter. Untick "Only verified-safe" to see the rest.'
                        : 'No contacts for this filter.'}
                    </td>
                  </tr>
                ) : (
                  visibleContacts.map((c) => {
                    const status = statusOf(c)
                    const vBadge = VERIFY_BADGES[status]
                    const VIcon = vBadge.icon
                    const rBadge = ROLE_BADGES[c.role] ?? ROLE_BADGES.other
                    const sBadge = SOURCE_BADGES[c.source] ?? SOURCE_BADGES.website
                    const isInvalid = status === 'invalid'
                    return (
                      <tr key={c.email} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selected.has(c.email) && !isInvalid}
                            disabled={isInvalid}
                            onCheckedChange={(v) => toggle(c.email, v === true)}
                            aria-label={`Select ${c.email}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${rBadge.className}`}>
                            {rBadge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">{c.name || '—'}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground max-w-[200px] truncate" title={c.title}>{c.title || '—'}</td>
                        <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">{c.email}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${sBadge.className}`}>
                            {sBadge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{Math.round(c.confidence)}%</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${vBadge.className}`}
                            title={c.verification?.reason}
                          >
                            <VIcon className="w-3 h-3" />
                            {vBadge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{c.company}</td>
                        <td className="px-4 py-3 text-xs">
                          {c.sourceUrl ? (
                            <a
                              href={c.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline max-w-[180px] truncate"
                              title={c.sourceUrl}
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {c.sourceUrl.replace(/^https?:\/\//, '')}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
