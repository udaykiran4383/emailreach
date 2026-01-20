'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import RecipientUpload from './components/recipient-upload'
import EmailPreview from './components/email-preview'
import CampaignAnalytics from './components/campaign-analytics'
import { Textarea } from '@/components/ui/textarea'
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
  Mail
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
  const [lastSync, setLastSync] = useState(0)

  useEffect(() => {
    fetchCampaign()
  }, [campaignId])

  useEffect(() => {
    if (campaign?.follow_up_template) {
      setFollowUpTemplate(campaign.follow_up_template)
    }
  }, [campaign])

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
        alert(`Emails sent successfully! Sent: ${result.sentCount}/${result.totalRecipients}`)
        setLastSync(Date.now())
        fetchCampaign()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error sending campaign:', error)
      alert('Failed to send campaign')
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
        alert('Campaign scheduled successfully!')
        setLastSync(Date.now())
        fetchCampaign()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
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
      if (res.ok) alert('Template saved!')
    } catch (e) {
      alert('Failed to save')
    }
  }

  const sendFollowUps = async () => {
    setSending(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-followup`, { method: 'POST' })
      const data = await res.json()

      if (data.sentCount === 0) {
        alert('No eligible recipients found.\n\nCriteria for follow-up:\n- Status: "Sent"\n- Not Replied yet\n- No follow-up sent previously')
      } else {
        alert(`Success! Follow-ups sent to ${data.sentCount} recipients.`)
        setLastSync(Date.now())
      }
    } catch (e) {
      alert('Failed to send follow-ups')
    } finally {
      setSending(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/sync`, { method: 'POST' })
      const data = await res.json()

      let message = `Sync complete!\nReplied: ${data.replied}\nBounced: ${data.bounced}`
      if (data.logs && data.logs.length > 0) {
        message += `\n\nLogs:\n${data.logs.join('\n')}`
      }
      if (data.errors && data.errors.length > 0) {
        message += `\n\nErrors:\n${data.errors.join('\n')}`
      }

      console.log('--- Sync Debug Info ---')
      console.log('Replied:', data.replied)
      console.log('Bounced:', data.bounced)
      if (data.logs && data.logs.length > 0) {
        console.log('Logs:', data.logs)
      }
      if (data.errors && data.errors.length > 0) {
        console.error('Errors:', data.errors)
      }
      console.log('-----------------------')

      alert(message)
      setLastSync(Date.now())
      fetchCampaign()
    } catch (e) {
      alert('Sync failed')
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
                {syncing ? 'Syncing...' : 'Sync Status'}
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
                disabled={campaign.status !== 'draft' || sending}
                onClick={handleSendNow}
              >
                <Send className="w-4 h-4 mr-2" />
                {sending ? 'Sending...' : 'Send Now'}
              </Button>
            </div>
          </div>
          <div className="animate-fadeIn">
            <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
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
            <CampaignAnalytics campaignId={campaignId} />
          )}
        </div>
      </div>
    </div>
  )
}
