'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import RecipientUpload from './components/recipient-upload'
import EmailPreview from './components/email-preview'
import CampaignAnalytics from './components/campaign-analytics'
import SkippedRecipients from './components/skipped-recipients'
import { Textarea } from '@/components/ui/textarea'
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
  Save,
  Mail,
  ShieldAlert,
  CheckCircle,
  AlertTriangle,
  XCircle
} from 'lucide-react'

interface Campaign {
  id: string
  name: string
  subject_template: string
  email_body_template: string
  follow_up_template?: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent'
  recipients_count: number
  sent_count: number
  created_at: string
}

const tabs = [
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'recipients', label: 'Recipients', icon: Users },
  { id: 'followup', label: 'Follow-up', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'skipped', label: 'Skipped (Verification)', icon: ShieldAlert },
] as const

type TabId = typeof tabs[number]['id']

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
  const [followUpTemplate, setFollowUpTemplate] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncDuration, setSyncDuration] = useState(0)
  const [lastSync, setLastSync] = useState(0)
  const [showAuthError, setShowAuthError] = useState(false)
  const [rateLimitInfo, setRateLimitInfo] = useState<{ retries: { email: string; attempt: number; waitSeconds: number }[] } | null>(null)

  useEffect(() => {
    fetchCampaign()
  }, [campaignId])

  useEffect(() => {
    if (campaign?.follow_up_template) {
      setFollowUpTemplate(campaign.follow_up_template)
    }
  }, [campaign])

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

  const handleSendNow = async () => {
    if (!campaign) return

    setSending(true)
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendImmediately: true }),
      })

      if (response.ok) {
        const result = await response.json()
        if (result.authError) {
          setShowAuthError(true)
        } else if (result.stopped) {
          toast.warning(`Campaign paused. Sent: ${result.sentCount}. ${result.errors?.[0] || ''}`)
        } else {
          toast.success(`Emails sent! Sent: ${result.sentCount}/${result.totalRecipients}`)
        }

        // Show rate limit dialog if any retries occurred
        if (result.rateLimitRetries && result.rateLimitRetries.length > 0) {
          setRateLimitInfo({ retries: result.rateLimitRetries })
        }

        setLastSync(Date.now())
        fetchCampaign()
      } else {
        const error = await response.json()
        if (error.error?.includes('invalid_grant') || error.error?.includes('Gmail token')) {
          setShowAuthError(true)
        } else {
          toast.error(`Error: ${error.error}`)
        }
      }
    } catch (error) {
      console.error('Error sending campaign:', error)
      toast.error('Failed to send campaign')
    } finally {
      setSending(false)
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

  const saveFollowUpTemplate = async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_template: followUpTemplate }),
      })
      if (res.ok) toast.success('Template saved!')
    } catch (e) {
      toast.error('Failed to save')
    }
  }

  const sendFollowUps = async () => {
    setSending(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-followup`, { method: 'POST' })
      const data = await res.json()

      if (data.sentCount === 0) {
        toast.info('No eligible recipients found', {
          description: 'Criteria: Status=Sent, Not Replied, No follow-up sent'
        })
      } else {
        toast.success(`Follow-ups sent to ${data.sentCount} recipients!`)
        setLastSync(Date.now())
      }
    } catch (e) {
      toast.error('Failed to send follow-ups')
    } finally {
      setSending(false)
    }
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
                disabled={campaign.status === 'sending' || sending}
                onClick={handleSendNow}
              >
                <Send className="w-4 h-4 mr-2" />
                {sending ? 'Sending...' :
                  campaign.status === 'scheduled' ? `Resume Campaign (${campaign.recipients_count - campaign.sent_count} pending)` :
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
                      'bg-red-200 text-red-800'
                }`}>
                {campaign.status === 'sending' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
              </span>
            </div>
            <p className="text-white/70 text-sm mt-1">{campaign.subject_template}</p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
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
            <EmailPreview subject={campaign.subject_template} body={campaign.email_body_template} />
          )}

          {activeTab === 'recipients' && (
            <RecipientUpload campaignId={campaignId} lastSync={lastSync} />
          )}

          {activeTab === 'followup' && (
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-xl p-6 card-hover">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg gradient-primary">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Follow-up Template</h3>
                    <p className="text-sm text-muted-foreground">
                      Send to recipients who haven't replied after a few days
                    </p>
                  </div>
                </div>
                <Textarea
                  value={followUpTemplate}
                  onChange={(e) => setFollowUpTemplate(e.target.value)}
                  placeholder="Hi {name}, just bumping this up..."
                  className="min-h-[200px] mb-4 resize-none"
                />
                <div className="flex gap-3">
                  <Button onClick={saveFollowUpTemplate} className="gradient-primary text-white hover:opacity-90">
                    <Save className="w-4 h-4 mr-2" />
                    Save Template
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={sendFollowUps}
                    disabled={sending}
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {sending ? 'Sending...' : 'Send Follow-ups'}
                  </Button>
                </div>
              </div>
            </div>
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

      {/* Rate Limit Info Modal */}
      {rateLimitInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border bg-amber-50 dark:bg-amber-950/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg">
                  <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="font-semibold text-lg text-amber-800 dark:text-amber-200">Rate Limit Detected</h3>
              </div>
            </div>
            <div className="p-6">
              <p className="text-muted-foreground mb-4">
                Gmail rate limiting was encountered during sending. The system automatically retried and completed successfully.
              </p>
              <div className="bg-muted rounded-lg p-3 mb-4 max-h-40 overflow-y-auto text-sm">
                {rateLimitInfo.retries.map((r, i) => (
                  <div key={i} className="py-1 border-b border-border last:border-0">
                    <span className="text-amber-600">⏳</span> {r.email}: Retry {r.attempt}, waited {r.waitSeconds}s
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setRateLimitInfo(null)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
