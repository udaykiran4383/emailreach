/**
 * Pure rules for multi-step sequences (no I/O), shared by the send engine,
 * the steps API and tests. Step 1 is the campaign's main email; steps 2..N
 * come from campaign_steps.
 */

export interface SequenceStep {
  step_number: number
  delay_days: number
  subject: string | null // null = reply in the same thread
  body: string
}

export interface SequenceRecipient {
  id: string
  email: string
  status: string
  replied_at?: string | null
  sent_at?: string | null
  current_step?: number | null
  last_step_sent_at?: string | null
  next_step_not_before?: string | null
  sequence_stopped?: boolean | null
}

export const MAX_STEPS = 5 // including step 1
const DAY_MS = 24 * 60 * 60 * 1000

// A reply from one of these is personal, not a "colleague at the same company"
const SHARED_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'gmx.com',
])

export function companyDomainOf(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase().trim()
  if (!domain || SHARED_MAIL_DOMAINS.has(domain)) return null
  return domain
}

export function nextStepFor(recipient: SequenceRecipient, steps: SequenceStep[]): SequenceStep | null {
  const current = recipient.current_step || 1
  return steps.find(s => s.step_number === current + 1) || null
}

export function stepDueAt(recipient: SequenceRecipient, step: SequenceStep): Date | null {
  const base = recipient.last_step_sent_at || recipient.sent_at
  if (!base) return null
  let due = new Date(new Date(base).getTime() + step.delay_days * DAY_MS)
  if (recipient.next_step_not_before) {
    const notBefore = new Date(recipient.next_step_not_before)
    if (notBefore > due) due = notBefore
  }
  return due
}

export type IneligibleReason = 'not_sent' | 'replied' | 'stopped' | 'no_next_step' | 'not_due' | 'colleague_replied'

export function checkStepEligibility(
  recipient: SequenceRecipient,
  steps: SequenceStep[],
  options: { onlyDue: boolean; repliedDomains: Set<string>; now?: Date }
): { eligible: true; step: SequenceStep } | { eligible: false; reason: IneligibleReason } {
  const now = options.now || new Date()
  if (recipient.status !== 'sent' || !recipient.sent_at) return { eligible: false, reason: 'not_sent' }
  if (recipient.replied_at) return { eligible: false, reason: 'replied' }
  if (recipient.sequence_stopped) return { eligible: false, reason: 'stopped' }

  const domain = companyDomainOf(recipient.email)
  if (domain && options.repliedDomains.has(domain)) return { eligible: false, reason: 'colleague_replied' }

  const step = nextStepFor(recipient, steps)
  if (!step) return { eligible: false, reason: 'no_next_step' }

  if (options.onlyDue) {
    const due = stepDueAt(recipient, step)
    if (!due || due > now) return { eligible: false, reason: 'not_due' }
  } else if (recipient.next_step_not_before && new Date(recipient.next_step_not_before) > now) {
    // Even a manual "send now" respects an out-of-office return date
    return { eligible: false, reason: 'not_due' }
  }
  return { eligible: true, step }
}

/** Subject for a step: its own subject, or "Re: <original>" to stay in the thread. */
export function stepSubject(step: SequenceStep, originalSubject: string): string {
  if (step.subject && step.subject.trim()) return step.subject.trim()
  const original = (originalSubject || '').trim()
  return /^re:/i.test(original) ? original : `Re: ${original}`
}

/** Validates and renumbers steps from the editor (2..N, in the given order). */
export function normalizeSteps(
  input: Array<{ delay_days: unknown; subject?: unknown; body: unknown }>
): { steps: SequenceStep[]; error?: string } {
  if (!Array.isArray(input)) return { steps: [], error: 'steps must be an array' }
  if (input.length > MAX_STEPS - 1) return { steps: [], error: `At most ${MAX_STEPS - 1} follow-up steps` }

  const steps: SequenceStep[] = []
  for (let i = 0; i < input.length; i++) {
    const raw = input[i]
    const delay = Math.round(Number(raw.delay_days))
    if (!Number.isFinite(delay) || delay < 1 || delay > 60) {
      return { steps: [], error: `Step ${i + 2}: delay must be between 1 and 60 days` }
    }
    const body = typeof raw.body === 'string' ? raw.body.trim() : ''
    if (!body) return { steps: [], error: `Step ${i + 2}: body is empty` }
    const subject = typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim() : null
    steps.push({ step_number: i + 2, delay_days: delay, subject, body })
  }
  return { steps }
}
