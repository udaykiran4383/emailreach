'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Inbox, Loader2, Send, Lightbulb } from 'lucide-react'

type Placement = 'inbox' | 'promotions' | 'spam' | 'missing'

interface SeedResult {
  email: string
  sent: boolean
  error?: string
  placement: Placement | null
}

interface PlacementTestData {
  id: string
  seeds: SeedResult[]
  sent_count: number
  created_at: string
  summary: {
    counts: Record<Placement, number>
    recorded: number
    total: number
    advice: string[]
  }
}

const OPTIONS: { value: Placement; label: string; className: string }[] = [
  { value: 'inbox', label: 'Primary', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
  { value: 'promotions', label: 'Promotions', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  { value: 'spam', label: 'Spam', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  { value: 'missing', label: 'Not found', className: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
]

export default function PlacementTest({ campaignId }: { campaignId: string }) {
  const [seedText, setSeedText] = useState('')
  const [test, setTest] = useState<PlacementTestData | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetch(`/api/placement-test?campaignId=${campaignId}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.tests?.[0]) setTest(data.tests[0])
      })
      .catch(() => {})
  }, [campaignId])

  const runTest = async () => {
    const seedEmails = seedText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    setRunning(true)
    try {
      const res = await fetch('/api/placement-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, seedEmails }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Test failed')
      setTest(data.test)
      toast.success(`Sent ${data.test.sent_count} test email${data.test.sent_count === 1 ? '' : 's'}. Check those inboxes.`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRunning(false)
    }
  }

  const record = async (email: string, placement: Placement) => {
    if (!test) return
    try {
      const res = await fetch('/api/placement-test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: test.id, placements: { [email]: placement } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setTest(data.test)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 mt-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-primary/10">
          <Inbox className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Inbox placement test</h3>
          <p className="text-sm text-muted-foreground">
            Send this email to 1-5 of your own other inboxes (ideally Gmail and Outlook) before the campaign.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        We can&apos;t read your other inboxes; check them and record where it landed. Test emails count toward your daily limit.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Textarea
          value={seedText}
          onChange={(e) => setSeedText(e.target.value)}
          placeholder="me.personal@outlook.com, my.other@gmail.com"
          className="min-h-[60px] resize-none flex-1"
        />
        <Button onClick={runTest} disabled={running || !seedText.trim()} className="sm:self-start">
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          {running ? 'Sending...' : 'Send test'}
        </Button>
      </div>

      {test && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Last test: {new Date(test.created_at).toLocaleString()} · {test.sent_count}/{test.seeds.length} sent
          </p>
          {test.seeds.map(seed => (
            <div key={seed.email} className="flex flex-col sm:flex-row sm:items-center gap-2 border border-border rounded-lg p-3">
              <span className="text-sm font-medium flex-1 break-all">{seed.email}</span>
              {!seed.sent ? (
                <span className="text-xs text-red-600">Not sent: {seed.error}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => record(seed.email, option.value)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        seed.placement === option.value
                          ? `${option.className} border-transparent`
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {test.summary.advice.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-1.5">
              <p className="text-sm font-medium flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                {test.summary.recorded > 0
                  ? `${test.summary.counts.inbox} Primary · ${test.summary.counts.promotions} Promotions · ${test.summary.counts.spam} Spam · ${test.summary.counts.missing} not found`
                  : 'Next step'}
              </p>
              {test.summary.advice.map(line => (
                <p key={line} className="text-sm text-muted-foreground">{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
