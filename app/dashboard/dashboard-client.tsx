'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import CampaignList from './components/campaign-list'
import CreateCampaignModal from './components/create-campaign-modal'
import RecentActivity from './components/recent-activity'
import { DashboardStats } from './components/dashboard-stats'
import TodayCard from './components/home/today-card'
import ActivityChart from './components/home/activity-chart'
import SetupBanner from './components/home/setup-banner'
import ActiveCampaigns from './components/home/active-campaigns'
import { FollowUpsDue, NextSteps, RepliesToHandle } from './components/home/action-cards'
import type { DashboardSummary, HealthReportData } from './components/home/types'
import { Mail, Plus, Loader2, Sparkles } from 'lucide-react'

interface Campaign {
  id: string
  name: string
  subject_template: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent'
  recipients_count: number
  sent_count: number
  created_at: string
}

export default function DashboardClient({
  userId,
  userEmail,
}: {
  userId: string
  userEmail?: string
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [health, setHealth] = useState<HealthReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [greeting, setGreeting] = useState('Welcome back')

  const fetchSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/summary', { cache: 'no-store' })
      if (response.ok) setSummary(await response.json())
    } catch (error) {
      console.error('Error fetching dashboard summary:', error)
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchCampaigns(), fetchSummary()]).finally(() => setLoading(false))

    // The setup banner is secondary: load it without blocking the page
    fetch('/api/health', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(setHealth)
      .catch(() => {})

    // Keep "Today" fresh while the tab is open
    const interval = setInterval(fetchSummary, 60_000)

    // Set time-based greeting
    const hour = new Date().getHours()
    if (hour < 12) setGreeting('Good morning')
    else if (hour < 18) setGreeting('Good afternoon')
    else setGreeting('Good evening')

    return () => clearInterval(interval)
  }, [fetchSummary])

  const fetchCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns')
      if (response.ok) {
        const data = await response.json()
        setCampaigns(data)
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error)
    }
  }

  const handleCreateCampaign = (newCampaign: Campaign) => {
    setCampaigns([newCampaign, ...campaigns])
    setShowCreateModal(false)
    fetchSummary()
  }

  const handleDeleteCampaign = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setCampaigns(campaigns.filter((c) => c.id !== campaignId))
        fetchSummary()
      }
    } catch (error) {
      console.error('Error deleting campaign:', error)
    }
  }

  const activeCount = summary?.activeCampaigns.filter(c => c.status !== 'draft').length ?? 0

  return (
    <div className="flex flex-col gap-6 py-8 animate-enter">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            {greeting}, {userEmail?.split('@')[0] || 'User'} <span className="text-2xl">👋</span>
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Here's what's happening with your outreach today.
          </p>
        </div>
        <Button
          onClick={() => setShowCreateModal(true)}
          size="lg"
          className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105"
        >
          <Plus className="w-5 h-5 mr-2" />
          New Campaign
        </Button>
      </div>

      <SetupBanner health={health} />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 glass-panel rounded-2xl">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground font-medium">Loading command center...</p>
        </div>
      ) : (
        <>
          {summary && (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <TodayCard today={summary.today} />
                <div className="lg:col-span-2">
                  <ActivityChart data={summary.chart} />
                </div>
              </div>

              <DashboardStats totals={summary.totals} activeCampaigns={activeCount} />

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                <RepliesToHandle replies={summary.replies} />
                <FollowUpsDue followUps={summary.followUpsDue} />
                <NextSteps pipeline={summary.pipeline} />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Campaigns Section - Takes 2/3 width */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Recent Campaigns
                </h2>
              </div>

              {campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 glass-panel rounded-2xl border-dashed">
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                    <Mail className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-foreground">No campaigns yet</h3>
                  <p className="text-muted-foreground mb-8 max-w-md text-center text-base">
                    Ready to scale your outreach? Create your first campaign to start connecting with employers.
                  </p>
                  <Button onClick={() => setShowCreateModal(true)} size="lg">
                    <Plus className="w-5 h-5 mr-2" />
                    Create First Campaign
                  </Button>
                </div>
              ) : (
                <CampaignList
                  campaigns={campaigns}
                  onDelete={handleDeleteCampaign}
                />
              )}
            </div>

            {/* Side column - Takes 1/3 width */}
            <div className="space-y-6">
              {summary && <ActiveCampaigns campaigns={summary.activeCampaigns} />}
              <RecentActivity />
            </div>
          </div>
        </>
      )}

      <CreateCampaignModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreateCampaign={handleCreateCampaign}
      />
    </div>
  )
}
