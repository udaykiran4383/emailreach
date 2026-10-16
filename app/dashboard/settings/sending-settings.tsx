'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

interface Settings {
  daily_limit: number
  warmup_enabled: boolean
  warmup_start: number
  warmup_increment: number
  min_delay_seconds: number
  max_delay_seconds: number
  send_window_start: number
  send_window_end: number
  skip_weekends: boolean
  timezone: string
  max_bounce_rate: number
  use_recipient_timezone: boolean
}

interface Budget {
  sentLast24h: number
  dailyLimit: number
  remaining: number
  warmupDay: number
}

interface WindowStatus {
  open: boolean
  message: string
  localTime: string
}

const numberFields: { key: keyof Settings; label: string; help?: string }[] = [
  { key: 'daily_limit', label: 'Daily limit', help: 'Max emails per 24h (first emails + follow-ups)' },
  { key: 'min_delay_seconds', label: 'Min gap (seconds)' },
  { key: 'max_delay_seconds', label: 'Max gap (seconds)' },
  { key: 'send_window_start', label: 'Send from (hour, 0-23)' },
  { key: 'send_window_end', label: 'Send until (hour, 1-24)' },
  { key: 'max_bounce_rate', label: 'Auto-pause above bounce rate (%)' },
]

export default function SendingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [windowStatus, setWindowStatus] = useState<WindowStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const applyResponse = (data: any) => {
    setSettings(data.settings)
    setBudget(data.budget)
    setWindowStatus(data.window)
  }

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/sender-settings')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      applyResponse(data)
    } catch (e: any) {
      setError(e.message || 'Failed to load sending settings')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const response = await fetch('/api/sender-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      applyResponse(data)
      toast.success('Sending limits saved')
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 mt-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">Sending Limits</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Emails go out one at a time with random gaps, inside business hours, under a daily cap.
        This keeps your Gmail account from being flagged.
      </p>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : error || !settings ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="space-y-5">
          {budget && (
            <div className="rounded-lg bg-muted/50 border border-border p-4 text-sm space-y-1">
              <p className="font-medium text-foreground">
                {budget.sentLast24h} of {budget.dailyLimit} sent in the last 24h
              </p>
              {settings.warmup_enabled && budget.dailyLimit < settings.daily_limit && (
                <p className="text-muted-foreground">
                  Warm-up day {budget.warmupDay}: limit grows by {settings.warmup_increment}/day up to {settings.daily_limit}.
                </p>
              )}
              {windowStatus && (
                <p className={windowStatus.open ? 'text-green-600' : 'text-amber-600'}>
                  {windowStatus.message} · now {windowStatus.localTime}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {numberFields.map(field => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type="number"
                  value={String(settings[field.key])}
                  onChange={e => update(field.key, Number(e.target.value) as never)}
                />
                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <Input
                id="timezone"
                value={settings.timezone}
                onChange={e => update('timezone', e.target.value)}
                placeholder="Asia/Kolkata"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="warmup">Warm-up</Label>
              <p className="text-xs text-muted-foreground">
                Start at {settings.warmup_start}/day and add {settings.warmup_increment} each day. Recommended for new accounts.
              </p>
            </div>
            <Switch id="warmup" checked={settings.warmup_enabled} onCheckedChange={v => update('warmup_enabled', v)} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="weekends">Skip weekends</Label>
            <Switch id="weekends" checked={settings.skip_weekends} onCheckedChange={v => update('skip_weekends', v)} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="recipient-tz">Send in each recipient&apos;s local hours</Label>
              <p className="text-xs text-muted-foreground">
                Uses the sending hours above in the recipient&apos;s timezone, guessed from their email domain
                (.in, .uk, .de ...). Addresses on .com and other generic domains use your timezone.
              </p>
            </div>
            <Switch
              id="recipient-tz"
              checked={Boolean(settings.use_recipient_timezone)}
              onCheckedChange={v => update('use_recipient_timezone', v)}
            />
          </div>

          <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {saving ? 'Saving...' : 'Save Limits'}
          </Button>
        </div>
      )}
    </div>
  )
}
