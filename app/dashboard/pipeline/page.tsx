'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { KanbanSquare, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { STAGES, STAGE_LABELS, stageAtLeast, type Stage } from '@/lib/pipeline/stages'
import ApplicationCard from './components/application-card'
import ApplicationSheet from './components/application-sheet'
import AddCompanyDialog from './components/add-company-dialog'
import { PipelineApplication, STAGE_STYLES } from './components/types'

export default function PipelinePage() {
  const [applications, setApplications] = useState<PipelineApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [dragOver, setDragOver] = useState<Stage | null>(null)

  useEffect(() => {
    fetchPipeline()
  }, [])

  const fetchPipeline = async () => {
    try {
      const res = await fetch('/api/pipeline', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load pipeline')
      setApplications(data.applications || [])
    } catch (error: any) {
      toast.error(error.message.includes('applications')
        ? 'Pipeline tables missing — run scripts/10_pipeline.sql in Supabase'
        : error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      toast.success(`Synced ${data.processed} companies from your campaigns`)
      fetchPipeline()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSyncing(false)
    }
  }

  const moveTo = async (id: string, stage: Stage) => {
    const app = applications.find((a) => a.id === id)
    if (!app || app.stage === stage) return
    const previous = app.stage
    // Optimistic move, rolled back on failure
    setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, stage } : a)))
    try {
      const res = await fetch(`/api/pipeline/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Move failed')
      fetchPipeline()
    } catch (error: any) {
      setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, stage: previous } : a)))
      toast.error(error.message)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return applications
    return applications.filter((a) =>
      [a.company, a.domain, a.job_title || '', a.notes || ''].some((v) => v.toLowerCase().includes(q))
    )
  }, [applications, search])

  const stats = useMemo(() => {
    const contacted = applications.filter((a) => stageAtLeast(a.stage, 'contacted')).length
    const replied = applications.filter((a) => stageAtLeast(a.stage, 'replied')).length
    const interviews = applications.filter((a) => stageAtLeast(a.stage, 'interview')).length
    const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—')
    return [
      { label: 'Companies', value: String(applications.length) },
      { label: 'Contacted', value: String(contacted) },
      { label: 'Response rate', value: pct(replied, contacted) },
      { label: 'Interview rate', value: pct(interviews, contacted) },
    ]
  }, [applications])

  const selected = applications.find((a) => a.id === selectedId) || null

  return (
    <div className="flex flex-col gap-6 py-8 animate-enter min-w-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <KanbanSquare className="w-7 h-7 text-primary" />
            Pipeline
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Every company you're pursuing, from first email to offer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Sync from campaigns
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add company
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, role, notes…"
          className="pl-9"
          aria-label="Search pipeline"
        />
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 glass-panel rounded-2xl">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground font-medium">Loading pipeline...</p>
        </div>
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 glass-panel rounded-2xl border-dashed text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <KanbanSquare className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Your pipeline is empty</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            Add a company you want to work at, or pull in every company you've already emailed.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              Sync from campaigns
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add company
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-4">
          <div className="flex gap-4 min-w-max">
            {STAGES.map((stage) => {
              const items = filtered.filter((a) => a.stage === stage)
              return (
                <section
                  key={stage}
                  aria-label={`${STAGE_LABELS[stage]} (${items.length})`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOver !== stage) setDragOver(stage)
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const id = e.dataTransfer.getData('text/plain')
                    if (id) moveTo(id, stage)
                  }}
                  className={`w-72 shrink-0 rounded-xl border p-3 flex flex-col gap-3 transition-colors ${dragOver === stage ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
                    }`}
                >
                  <header className="flex items-center justify-between px-1">
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <span className={`w-2 h-2 rounded-full ${STAGE_STYLES[stage].dot}`} />
                      {STAGE_LABELS[stage]}
                    </h2>
                    <span className="text-xs text-muted-foreground font-medium">{items.length}</span>
                  </header>
                  <div className="flex flex-col gap-2 min-h-[80px]">
                    {items.map((app) => (
                      <ApplicationCard
                        key={app.id}
                        application={app}
                        onOpen={() => setSelectedId(app.id)}
                        onStageChange={(s) => moveTo(app.id, s)}
                      />
                    ))}
                    {items.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">Drop a card here</p>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      <ApplicationSheet
        application={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onChanged={fetchPipeline}
        onDeleted={(id) => setApplications((apps) => apps.filter((a) => a.id !== id))}
      />

      <AddCompanyDialog open={showAdd} onOpenChange={setShowAdd} onCreated={fetchPipeline} />
    </div>
  )
}
