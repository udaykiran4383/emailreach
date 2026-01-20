import { getUser } from '@/lib/auth/actions'
import { redirect } from 'next/navigation'
import CampaignDetailClient from './campaign-detail-client'

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { id } = await params

  return <CampaignDetailClient campaignId={id} userId={user.id} />
}
