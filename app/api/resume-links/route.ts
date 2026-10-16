import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth/actions'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getPublicBaseUrl } from '@/lib/email/tracking'
import {
  createResumeUrl,
  getOrCreateCampaignLink,
  getResumeViewStats,
  writeResumeUrls,
} from '@/lib/resume-links'

/**
 * POST { campaignId, action: 'enable' | 'disable' | 'stats' }
 * - enable: create the campaign's link, write variables.resume_url on every
 *   recipient and stop attaching the PDF (safe to re-run for new recipients)
 * - disable: attach the PDF again (links keep working)
 * - stats: who viewed the resume
 */
export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { campaignId, action } = await request.json().catch(() => ({}))
  if (!campaignId || !['enable', 'disable', 'stats'].includes(action)) {
    return NextResponse.json({ error: 'campaignId and a valid action are required' }, { status: 400 })
  }

  const supabase = await getSupabaseServerClient()
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('id, resume_storage_path, attach_resume')
    .eq('id', campaignId)
    .eq('user_id', user.id)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  try {
    if (action === 'disable') {
      await supabase.from('campaigns').update({ attach_resume: true }).eq('id', campaignId)
      return NextResponse.json({ success: true, attachResume: true })
    }

    const publicBase = getPublicBaseUrl()

    if (action === 'stats') {
      if (!campaign.resume_storage_path) {
        return NextResponse.json({ enabled: false, hasResume: false, publicBase: !!publicBase, attachResume: campaign.attach_resume !== false })
      }
      const link = await getOrCreateCampaignLink(user.id, campaign)
      const stats = await getResumeViewStats(link.id)
      return NextResponse.json({
        enabled: campaign.attach_resume === false,
        hasResume: true,
        publicBase: !!publicBase,
        attachResume: campaign.attach_resume !== false,
        previewUrl: createResumeUrl(link.id),
        ...stats,
      })
    }

    // enable
    if (!campaign.resume_storage_path) {
      return NextResponse.json({ error: 'Upload a resume to this campaign first' }, { status: 400 })
    }
    if (!publicBase) {
      return NextResponse.json(
        { error: 'Set NEXT_PUBLIC_SITE_URL (or TRACKING_BASE_URL) to your public site URL — recipients can’t open localhost links.' },
        { status: 400 }
      )
    }

    const link = await getOrCreateCampaignLink(user.id, campaign)
    const updated = await writeResumeUrls(campaignId, link.id)
    await supabase.from('campaigns').update({ attach_resume: false }).eq('id', campaignId)

    return NextResponse.json({ success: true, updated, attachResume: false, previewUrl: createResumeUrl(link.id) })
  } catch (err: any) {
    console.error('[resume-links] Error:', err?.message || err)
    return NextResponse.json({ error: err?.message || 'Resume link failed' }, { status: 500 })
  }
}
