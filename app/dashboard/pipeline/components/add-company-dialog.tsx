'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STAGES, STAGE_LABELS, type Stage } from '@/lib/pipeline/stages'

export default function AddCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [company, setCompany] = useState('')
  const [website, setWebsite] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [stage, setStage] = useState<Stage>('target')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setCompany('')
    setWebsite('')
    setJobTitle('')
    setJobUrl('')
    setStage('target')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!website.trim()) {
      toast.error('Add the company website or domain')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, url: website, jobTitle, jobUrl, stage }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add company')
      toast.success(`${company || website} added to your pipeline`)
      reset()
      onOpenChange(false)
      onCreated()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add company</DialogTitle>
            <DialogDescription>Track a company or a specific job posting.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="pipeline-website">Website or domain</Label>
            <Input id="pipeline-website" placeholder="acme.com" value={website} onChange={(e) => setWebsite(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-company">Company name</Label>
            <Input id="pipeline-company" placeholder="Acme (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pipeline-job-title">Job title</Label>
              <Input id="pipeline-job-title" placeholder="Backend Engineer" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pipeline-stage">Stage</Label>
              <select
                id="pipeline-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value as Stage)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pipeline-job-url">Job posting URL</Label>
            <Input id="pipeline-job-url" placeholder="https://… (optional)" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
