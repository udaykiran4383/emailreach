import { createClient } from '@supabase/supabase-js'
import { sendEmailViaGmail } from '@/lib/email/sender'
import { downloadResume } from '@/lib/storage/resume'
import { getSenderSettings, getSendBudget } from '@/lib/email/deliverability'
import { getResumeUrlForRecipient } from '@/lib/resume-links'

/**
 * Inbox placement test: sends the campaign's first email to a few of the user's own
 * other inboxes ("seeds"). We can't read those inboxes, so the user records where each
 * copy landed and we turn that into advice.
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

export const MAX_SEEDS = 5
export type Placement = 'inbox' | 'promotions' | 'spam' | 'missing'
export const PLACEMENTS: Placement[] = ['inbox', 'promotions', 'spam', 'missing']

export interface SeedResult {
  email: string
  sent: boolean
  error?: string
  placement: Placement | null
}

export interface PlacementTest {
  id: string
  campaign_id: string
  seeds: SeedResult[]
  sent_count: number
  created_at: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeSeeds(input: unknown, senderEmail: string): { seeds: string[]; error?: string } {
  if (!Array.isArray(input)) return { seeds: [], error: 'seedEmails must be a list' }
  const seeds = [...new Set(input.map(e => String(e).trim().toLowerCase()).filter(Boolean))]
  if (seeds.length === 0) return { seeds, error: 'Add at least one inbox to test' }
  if (seeds.length > MAX_SEEDS) return { seeds, error: `At most ${MAX_SEEDS} test inboxes` }
  const bad = seeds.find(e => !EMAIL_RE.test(e))
  if (bad) return { seeds, error: `Not an email address: ${bad}` }
  if (seeds.includes(senderEmail.toLowerCase())) {
    // Gmail files your own sends under Sent, so the result would say nothing about placement
    return { seeds, error: `${senderEmail} is the account you send from - use a different inbox` }
  }
  return { seeds }
}

export function summarizePlacement(seeds: SeedResult[]) {
  const counts: Record<Placement, number> = { inbox: 0, promotions: 0, spam: 0, missing: 0 }
  for (const seed of seeds) if (seed.placement) counts[seed.placement]++
  const recorded = counts.inbox + counts.promotions + counts.spam + counts.missing

  const advice: string[] = []
  if (recorded === 0) {
    advice.push('Check each test inbox (including Spam and Promotions) and record where the email landed.')
  } else {
    if (counts.spam > 0) {
      advice.push('Landed in Spam: remove links and the attachment, cut marketing words (see the Deliverability check), and lower your daily limit for a few days.')
      advice.push('If a test inbox marked it spam, open it there and click "Not spam" - but fix the content before sending the campaign.')
    }
    if (counts.promotions > 0) {
      advice.push('Landed in Promotions: write it like a one-to-one note - plain text, one link at most, no images or tracking pixel, a personal first line.')
    }
    if (counts.missing > 0) {
      advice.push('Not delivered at all: check the Sent folder and for bounce notices; the address may be wrong or the provider rejected it.')
    }
    if (counts.inbox === recorded) {
      advice.push('Everything reached the Primary inbox. Keep the same content and volume.')
    }
  }
  return { counts, recorded, total: seeds.length, advice }
}

export async function runPlacementTest(userId: string, campaignId: string, seedInput: unknown): Promise<PlacementTest> {
  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single()
  if (!campaign) throw new Error('Campaign not found')

  const { data: credential } = await supabaseAdmin
    .from('gmail_credentials')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (!credential) throw new Error('Gmail account not connected')

  const { seeds, error } = normalizeSeeds(seedInput, credential.email_address)
  if (error) throw new Error(error)

  // Test sends are real emails from the same account, so they use the same daily budget
  const settings = await getSenderSettings(userId)
  const budget = await getSendBudget(userId, settings)
  if (budget.remaining < seeds.length) {
    throw new Error(`Daily limit: only ${budget.remaining} emails left today (${budget.sentLast24h}/${budget.dailyLimit})`)
  }

  // Personalize with a real recipient so the test email matches what recipients get
  const { data: sample } = await supabaseAdmin
    .from('email_recipients')
    .select('id, email, name, company, variables')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .limit(1)
  const sampleRecipient = sample?.[0]
  let sampleVariables: Record<string, unknown> | null = sampleRecipient?.variables || null
  if (sampleRecipient && /\{\{\s*resume_url\s*\}\}/i.test(campaign.email_body_template || '') && !sampleVariables?.resume_url) {
    const url = await getResumeUrlForRecipient(campaignId, sampleRecipient.id).catch(() => null)
    sampleVariables = { ...(sampleVariables || {}), resume_url: url || '' }
  }

  const attachments = []
  if (campaign.resume_storage_path && campaign.attach_resume !== false) {
    try {
      const resume = await downloadResume(campaign.resume_storage_path)
      if (resume) attachments.push({ filename: resume.filename, content: resume.content, contentType: 'application/pdf' })
    } catch (err) {
      console.error('Error downloading resume for placement test:', err)
    }
  }

  const { data: test, error: insertError } = await supabaseAdmin
    .from('placement_tests')
    .insert({ user_id: userId, campaign_id: campaignId, seeds: [], sent_count: 0 })
    .select()
    .single()
  if (insertError || !test) {
    throw new Error(`${insertError?.message || 'Could not create test'}. Run scripts/11_sequences.sql in Supabase.`)
  }

  const results: SeedResult[] = []
  for (const seed of seeds) {
    const result = await sendEmailViaGmail(
      { access_token: credential.access_token, refresh_token: credential.refresh_token },
      credential.email_address,
      {
        // Seed address, but the sample recipient's name/company/variables
        email: seed,
        name: sampleRecipient?.name || undefined,
        company: sampleRecipient?.company || undefined,
        variables: sampleVariables,
      },
      {
        subject: `[Placement test] ${campaign.subject_template}`,
        body: campaign.email_body_template,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
      true // seeds are the user's own inboxes
    )
    results.push({ email: seed, sent: result.success, error: result.success ? undefined : result.error, placement: null })
    // Small gap so the test doesn't look like a burst
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const sentCount = results.filter(r => r.sent).length
  const { data: saved } = await supabaseAdmin
    .from('placement_tests')
    .update({ seeds: results, sent_count: sentCount })
    .eq('id', test.id)
    .select()
    .single()

  return (saved || { ...test, seeds: results, sent_count: sentCount }) as PlacementTest
}

export async function getPlacementTests(userId: string, campaignId: string): Promise<PlacementTest[]> {
  const { data } = await supabaseAdmin
    .from('placement_tests')
    .select('*')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(5)
  return (data || []) as PlacementTest[]
}

export async function recordPlacement(
  userId: string,
  testId: string,
  placements: Record<string, Placement | null>
): Promise<PlacementTest> {
  const { data: test } = await supabaseAdmin
    .from('placement_tests')
    .select('*')
    .eq('id', testId)
    .eq('user_id', userId)
    .single()
  if (!test) throw new Error('Placement test not found')

  const seeds = (test.seeds as SeedResult[]).map(seed => {
    const value = placements[seed.email]
    if (value === undefined) return seed
    return { ...seed, placement: value && PLACEMENTS.includes(value) ? value : null }
  })

  const { data: saved, error } = await supabaseAdmin
    .from('placement_tests')
    .update({ seeds })
    .eq('id', testId)
    .select()
    .single()
  if (error || !saved) throw new Error(error?.message || 'Failed to save')
  return saved as PlacementTest
}
