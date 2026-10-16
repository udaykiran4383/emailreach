'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import RecipientUpload from './components/recipient-upload'
import EmailPreview from './components/email-preview'
import SequenceEditor from './components/sequence-editor'
import PlacementTest from './components/placement-test'
import ResumeLinkCard from './components/resume-link-card'
import CampaignAnalytics from './components/campaign-analytics'
import SkippedRecipients from './components/skipped-recipients'
import PersonalizePanel from './components/personalize-panel'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  ArrowLeft,
  RefreshCw,
  Clock,
  Send,
  Eye,
  Users,
  MessageSquare,
  BarChart3,
  Loader2,
  Mail,
  ShieldAlert,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Square,
  ShieldCheck,
  Sparkles
} from 'lucide-react'

interface Campaign {
  id: string
  name: string
  subject_template: string
  email_body_template: string
  follow_up_template?: string
  follow_up_days?: number
  auto_follow_up?: boolean
  track_opens?: boolean
  resume_storage_path?: string | null
  paused_reason?: string | null
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused'
  recipients_count: number
  sent_count: number
  created_at: string
}

const tabs = [
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'recipients', label: 'Recipients', icon: Users },
  { id: 'personalize', label: 'Personalize', icon: Sparkles },
  { id: 'followup', label: 'Sequence', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'skipped', label: 'Skipped (Verification)', icon: ShieldAlert },
] as const

type TabId = typeof tabs[number]['id']

type DripKind = 'campaign' | 'followup'

interface DripState {
  kind: DripKind
  sessionSent: number
  sentToday: number
  dailyLimit: number
  remaining: number
  nextSendAt: string | null
  message: string
}

// Reasons the server returns when there is nothing more to do for now
const DRIP_STOP_REASONS = ['done', 'daily_limit', 'outside_window', 'bounce_rate', 'auth', 'gmail_limit']

export default function CampaignDetailClient({
  campaignId,
  userId,
}: {
  campaignId: string
  userId: string
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('preview')
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncDuration, setSyncDuration] = useState(0)
  const [lastSync, setLastSync] = useState(0)
  const [showAuthError, setShowAuthError] = useState(false)
  const [drip, setDrip] = useState<DripState | null>(null)
  const [now, setNow] = useState(Date.now())
  const [autoFollowUp, setAutoFollowUp] = useState(false)
  // Bumping this cancels the running drip loop
  const dripRunRef = useRef(0)

  useEffect(() => {
    fetchCampaign()
  }, [campaignId])

  useEffect(() => {
    setAutoFollowUp(Boolean(campaign?.auto_follow_up))
  }, [campaign])

  // Countdown for the drip banner
  useEffect(() => {
    if (!drip) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [drip])

  // Stop the drip loop when leaving the page
  useEffect(() => {
    return () => {
      dripRunRef.current++
    }
  }, [])

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (syncing) {
      setSyncDuration(0)
      interval = setInterval(() => {
        setSyncDuration(prev => prev + 1)
      }, 1000)
    } else {
      setSyncDuration(0)
    }
    return () => clearInterval(interval)
  }, [syncing])

  const fetchCampaign = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`)
      if (response.ok) {
        const data = await response.json()
        setCampaign(data)
      }
    } catch (error) {
      console.error('Error fetching campaign:', error)
    } finally {
      setLoading(false)
    }
  }

  // Waits up to ms, returning early if the loop was cancelled
  const waitWhileRunning = async (ms: number, runId: number) => {
    const until = Date.now() + ms
    while (Date.now() < until && dripRunRef.current === runId) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  /**
   * Sends one email per server call and calls again at nextSendAt, so emails go out
   * slowly with random gaps instead of in a burst that gets Gmail accounts flagged.
   */
  const startDrip = async (kind: DripKind, { dueOnly = false }: { dueOnly?: boolean } = {}) => {
    const runId = ++dripRunRef.current
    let sessionSent = 0
    setSending(true)
    setDrip({ kind, sessionSent: 0, sentToday: 0, dailyLimit: 0, remaining: 0, nextSendAt: null, message: 'Starting...' })

    const url = kind === 'campaign'
      ? `/api/campaigns/${campaignId}/send`
      : `/api/campaigns/${campaignId}/send-followup${dueOnly ? '?due=1' : ''}`

    try {
      while (dripRunRef.current === runId) {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendImmediately: true }),
        })
        const result = await response.json()
        if (dripRunRef.current !== runId) break

        if (!response.ok) {
          if (result.error?.includes('invalid_grant') || result.error?.includes('Gmail token')) {
            setShowAuthError(true)
          } else {
            toast.error(`Error: ${result.error}`)
          }
          break
        }

        sessionSent += result.sentCount || 0
        setDrip({
          kind,
          sessionSent,
          sentToday: result.sentToday,
          dailyLimit: result.dailyLimit,
          remaining: result.remaining,
          nextSendAt: result.nextSendAt,
          message: result.message,
        })
        if (result.sentCount > 0 || result.skippedCount > 0) setLastSync(Date.now())

        if (result.authError || result.reason === 'auth') {
          setShowAuthError(true)
          break
        }

        if (DRIP_STOP_REASONS.includes(result.reason)) {
          const label = kind === 'campaign' ? 'emails' : 'follow-ups'
          if (result.reason === 'done') {
            toast.success(`All ${label} sent (${sessionSent} this session)`)
          } else if (result.reason === 'daily_limit' || result.reason === 'outside_window') {
            toast.info(result.message, {
              description: `${sessionSent} sent this session. ${result.remaining} left; the scheduler continues them automatically, or click Send again later.`,
            })
          } else {
            toast.warning(result.message)
          }
          break
        }

        // 'waiting': come back when the next send slot opens
        const waitMs = result.nextSendAt ? new Date(result.nextSendAt).getTime() - Date.now() : 0
        await waitWhileRunning(Math.max(waitMs + 1000, 5000), runId)
      }
    } catch (error) {
      console.error('Error sending:', error)
      toast.error('Failed to send')
    } finally {
      if (dripRunRef.current === runId) {
        setDrip(null)
        setSending(false)
      }
      fetchCampaign()
    }
  }

  const stopDrip = async () => {
    const kind = drip?.kind
    dripRunRef.current++
    setDrip(null)
    setSending(false)
    // Pause so the background scheduler doesn't keep sending either
    if (kind === 'campaign') {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paused', paused_reason: 'Stopped by you' }),
      })
    }
    toast.info('Sending stopped. Pending emails stay queued.')
    fetchCampaign()
  }

  const handleSendNow = () => startDrip('campaign')

  const updateCampaign = async (patch: Partial<Campaign>, successMessage?: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const data = await res.json()
      setCampaign(prev => (prev ? { ...prev, ...data } : prev))
      if (successMessage) toast.success(successMessage)
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message}`)
    }
  }

  const handleSchedule = async () => {
    if (!campaign) return

    setSending(true)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendImmediately: false }),
      })

      if (response.ok) {
        toast.success('Campaign scheduled successfully!')
        setLastSync(Date.now())
        fetchCampaign()
      } else {
        const error = await response.json()
        toast.error(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error scheduling campaign:', error)
      alert('Failed to schedule campaign')
    } finally {
      setSending(false)
    }
  }

  const saveAutoFollowUp = async (value: boolean) => {
    setAutoFollowUp(value)
    await updateCampaign(
      { auto_follow_up: value },
      value ? 'Due steps will be sent automatically' : 'Automatic follow-ups turned off'
    )
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/sync`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed')
      }

      // Show toast with sync results
      if (data.replied > 0 || data.bounced > 0) {
        toast.success('Sync complete!', {
          description: `📩 Replies: ${data.replied} | ❌ Bounced: ${data.bounced}`,
        })
      } else {
        toast.info('Sync complete - no changes detected')
      }

      // Log to console for debugging
      if (data.logs?.length > 0 || data.errors?.length > 0) {
        console.log('Sync results:', { replied: data.replied, bounced: data.bounced, logs: data.logs, errors: data.errors })
      }

      setLastSync(Date.now())
      fetchCampaign()
    } catch (e: any) {
      console.error('Sync error:', e)
      if (e.message?.includes('invalid_grant') || e.message?.includes('Gmail')) {
        setShowAuthError(true)
      } else {
        toast.error(`Sync failed: ${e.message}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-muted-foreground">Loading campaign...</p>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Mail className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Campaign not found</p>
        <Link href="/dashboard">
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Gradient Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-primary opacity-95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.15)_0%,_transparent_50%)]" />
        <div className="relative max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="border-white/30 text-white hover:bg-white/10 bg-white/5 backdrop-blur-sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="border-white/30 text-white hover:bg-white/10 bg-white/5 backdrop-blur-sm"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? `Syncing (${syncDuration}s)...` : 'Sync Status'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={campaign.status !== 'draft' || sending}
                onClick={handleSchedule}
                className="border-white/30 text-white hover:bg-white/10 bg-white/5 backdrop-blur-sm disabled:opacity-50"
              >
                <Clock className="w-4 h-4 mr-2" />
                {sending ? 'Processing...' : 'Schedule'}
              </Button>
              <Button
                size="sm"
                className="bg-white text-primary hover:bg-white/90 shadow-lg font-semibold disabled:opacity-50"
                disabled={sending}
                onClick={handleSendNow}
              >
                <Send className="w-4 h-4 mr-2" />
                {sending ? 'Sending...' :
                  campaign.status === 'scheduled' || campaign.status === 'paused' ? 'Resume Campaign' :
                    campaign.status === 'sent' ? 'All Sent' : 'Send Now'}
              </Button>
            </div>
          </div>
          <div className="animate-fadeIn">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${campaign.status === 'draft' ? 'bg-gray-200 text-gray-700' :
                campaign.status === 'sending' ? 'bg-blue-200 text-blue-800 animate-pulse' :
                  campaign.status === 'sent' ? 'bg-green-200 text-green-800' :
                    campaign.status === 'scheduled' ? 'bg-amber-200 text-amber-800' :
                      campaign.status === 'paused' ? 'bg-orange-200 text-orange-800' :
                      'bg-red-200 text-red-800'
                }`}>
                {campaign.status === 'sending' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
              </span>
            </div>
            <p className="text-white/70 text-sm mt-1">{campaign.subject_template}</p>
            {campaign.status === 'paused' && campaign.paused_reason && (
              <p className="text-white text-sm mt-2 inline-flex items-center gap-1.5 bg-black/20 rounded-md px-2.5 py-1">
                <AlertTriangle className="w-4 h-4" />
                Paused: {campaign.paused_reason}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {drip && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100">
                  Sending {drip.kind === 'followup' ? 'follow-ups ' : ''}slowly to protect your Gmail
                  {drip.dailyLimit > 0 && ` — ${drip.sentToday}/${drip.dailyLimit} today`}
                  {drip.nextSendAt && new Date(drip.nextSendAt).getTime() > now
                    && `, next email in ${Math.ceil((new Date(drip.nextSendAt).getTime() - now) / 1000)}s`}
                </p>
                <p className="text-blue-700 dark:text-blue-300">
                  {drip.sessionSent} sent this session · {drip.remaining} remaining. Keep this tab open, or let the scheduler continue.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={stopDrip}>
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Track opens</p>
            <p className="text-xs text-muted-foreground">
              Adds a 1px image. Slightly raises spam risk; needs a public site URL.
            </p>
          </div>
          <Switch
            checked={Boolean(campaign.track_opens)}
            onCheckedChange={(checked) =>
              updateCampaign({ track_opens: checked }, checked ? 'Open tracking on' : 'Open tracking off')
            }
          />
        </div>

        <div className="border-b border-border flex gap-1 mb-8 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 font-medium border-b-2 transition-all whitespace-nowrap ${isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="animate-fadeIn">
          {activeTab === 'preview' && (
            <EmailPreview
              subject={campaign.subject_template}
              body={campaign.email_body_template}
              hasAttachment={!!campaign.resume_storage_path}
              trackOpens={!!campaign.track_opens}
            />
          )}
          {activeTab === 'preview' && (
            <>
              <ResumeLinkCard campaignId={campaignId} lastSync={lastSync} />
              <PlacementTest campaignId={campaignId} />
            </>
          )}

          {activeTab === 'recipients' && (
            <RecipientUpload campaignId={campaignId} lastSync={lastSync} />
          )}

          {activeTab === 'personalize' && (
            <PersonalizePanel campaignId={campaignId} />
          )}

          {activeTab === 'followup' && (
            <SequenceEditor
              campaignId={campaignId}
              subject={campaign.subject_template}
              body={campaign.email_body_template}
              autoFollowUp={autoFollowUp}
              onAutoFollowUpChange={saveAutoFollowUp}
              sending={sending}
              onSendDue={() => startDrip('followup', { dueOnly: true })}
              onSendNextNow={() => startDrip('followup')}
            />
          )}

          {activeTab === 'analytics' && (
            <CampaignAnalytics campaignId={campaignId} lastSync={lastSync} />
          )}

          {activeTab === 'skipped' && (
            <SkippedRecipients campaignId={campaignId} />
          )}
        </div>
      </div>

      {/* Gmail Auth Error Modal */}
      {showAuthError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border bg-red-50 dark:bg-red-950/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded-lg">
                  <Mail className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="font-semibold text-lg text-red-800 dark:text-red-200">Gmail Token Expired</h3>
              </div>
            </div>
            <div className="p-6">
              <p className="text-muted-foreground mb-4">
                Your Gmail authentication has expired. Please reconnect your Gmail account to continue sending emails.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowAuthError(false)}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted rounded-md transition-colors"
                >
                  Dismiss
                </button>
                <Link href="/dashboard/settings">
                  <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
                    Go to Settings
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
