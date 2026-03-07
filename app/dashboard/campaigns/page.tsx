'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import CampaignList from '../components/campaign-list'
import CreateCampaignModal from '../components/create-campaign-modal'
import { Plus, Loader2, Mail, Sparkles } from 'lucide-react'

interface Campaign {
    id: string
    name: string
    subject_template: string
    status: 'draft' | 'scheduled' | 'sending' | 'sent'
    recipients_count: number
    sent_count: number
    created_at: string
}

export default function CampaignsPage() {
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
        <div className="flex flex-col gap-8 py-8 animate-enter">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Sparkles className="w-7 h-7 text-primary" />
                        All Campaigns
                    </h1>
                    <p className="text-muted-foreground mt-2 text-lg">
                        Manage and track all your email outreach campaigns.
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

            {/* Content */}
            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 glass-panel rounded-2xl">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
                    <p className="text-muted-foreground font-medium">Loading campaigns...</p>
                </div>
            ) : campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4 glass-panel rounded-2xl border-dashed">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                        <Mail className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground">No campaigns yet</h3>
                    <p className="text-muted-foreground mb-8 max-w-md text-center text-base">
                        Ready to scale your outreach? Create your first campaign to start connecting.
                    </p>
                    <Button onClick={() => setShowCreateModal(true)} size="lg">
                        <Plus className="w-5 h-5 mr-2" />
                        Create First Campaign
                    </Button>
                </div>
            ) : (
                <CampaignList campaigns={campaigns} onDelete={handleDeleteCampaign} />
            )}

            <CreateCampaignModal
                open={showCreateModal}
                onOpenChange={setShowCreateModal}
                onCreateCampaign={handleCreateCampaign}
            />
        </div>
    )
}
