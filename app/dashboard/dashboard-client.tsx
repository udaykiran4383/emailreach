'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import CampaignList from './components/campaign-list'
import CreateCampaignModal from './components/create-campaign-modal'
import { Mail, Plus, Loader2 } from 'lucide-react'

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
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => {
    fetchCampaigns()
  }, [])

  const fetchCampaigns = async () => {
    try {
      const response = await fetch('/api/campaigns')
      if (response.ok) {
        const data = await response.json()
        setCampaigns(data)
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCampaign = (newCampaign: Campaign) => {
    setCampaigns([newCampaign, ...campaigns])
    setShowCreateModal(false)
  }

  const handleDeleteCampaign = async (campaignId: string) => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setCampaigns(campaigns.filter((c) => c.id !== campaignId))
      }
    } catch (error) {
      console.error('Error deleting campaign:', error)
    }
  }

  return (
    <div className="flex flex-col gap-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your email outreach campaigns and track their performance.
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 border rounded-lg border-dashed">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading your campaigns...</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border rounded-lg border-dashed bg-card/50">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm text-center">
            Create your first email campaign to start reaching out to prospective employers.
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Campaign
          </Button>
        </div>
      ) : (
        <CampaignList
          campaigns={campaigns}
          onDelete={handleDeleteCampaign}
        />
      )}

      <CreateCampaignModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreateCampaign={handleCreateCampaign}
      />
    </div>
  )
}
