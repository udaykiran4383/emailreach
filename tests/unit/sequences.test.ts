import { describe, expect, it } from 'vitest'
import { buildTemplateValues, firstNameOf, renderTemplate } from '@/lib/email/template-vars'
import { guessTimezoneFromEmail, isInWindow, pickInWindow } from '@/lib/email/timezones'
import { checkStepEligibility, companyDomainOf, normalizeSteps, stepSubject } from '@/lib/campaigns/sequence-logic'

describe('template variables', () => {
  it('derives first_name only from real names', () => {
    expect(firstNameOf('priya sharma', 'p@x.com')).toBe('Priya')
    expect(firstNameOf('jdoe', 'jdoe@acme.com')).toBe('')
    expect(firstNameOf('there', 'careers@acme.com')).toBe('there')
    expect(firstNameOf('john.doe', 'john.doe@acme.com')).toBe('')
    expect(firstNameOf('J. Doe', 'x@acme.com')).toBe('')
  })

  it('renders custom vars, blanks unknown/empty ones and cleans the leftovers', () => {
    const v = buildTemplateValues({
      email: 'jdoe@acme.com',
      name: 'jdoe',
      company: 'Acme',
      variables: { job_title: 'Backend Engineer', opener: '', opener_draft: 'DRAFT' },
    })
    const body = renderTemplate('Hi {{first_name}},\n\n{{opener}}\n\nI saw the {{ job_title }} role at {{company}}. {{unknown_var}}\n\nThanks', v)
    expect(body).toBe('Hi,\n\nI saw the Backend Engineer role at Acme.\n\nThanks')
    expect(body).not.toContain('{{')
    expect(body).not.toContain('DRAFT')
    expect(renderTemplate('{{first_name}} - {{job_title}} at {{company}}', v, { singleLine: true })).toBe('- Backend Engineer at Acme')
  })

  it('lets core fields win over same-named custom variables', () => {
    const v = buildTemplateValues({ email: 'a@b.com', name: 'Ana Perez', company: 'B', variables: { company: 'Evil', First_Name: 'X' } })
    expect(renderTemplate('{{company}} {{first_name}} {{FIRST_NAME}}', v)).toBe('B Ana Ana')
  })
})

describe('recipient timezones', () => {
  it('guesses from ccTLDs, falling back to the sender timezone', () => {
    expect(guessTimezoneFromEmail('a@foo.co.in', 'America/New_York')).toBe('Asia/Kolkata')
    expect(guessTimezoneFromEmail('a@foo.co.uk', 'Asia/Kolkata')).toBe('Europe/London')
    expect(guessTimezoneFromEmail('a@foo.de', 'Asia/Kolkata')).toBe('Europe/Berlin')
    expect(guessTimezoneFromEmail('a@foo.com', 'Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(guessTimezoneFromEmail('a@foo.io', 'Asia/Kolkata')).toBe('Asia/Kolkata')
  })

  const win = { send_window_start: 9, send_window_end: 18, skip_weekends: true }
  // Wed 2026-10-14 06:00 UTC = 11:30 IST, 07:00 London
  const wed = new Date('2026-10-14T06:00:00Z')

  it('checks the window in the recipient timezone', () => {
    expect(isInWindow(win, 'Asia/Kolkata', wed)).toBe(true)
    expect(isInWindow(win, 'Europe/London', wed)).toBe(false)
    expect(isInWindow(win, 'Not/AZone', wed)).toBe(false)
    expect(isInWindow(win, 'Asia/Kolkata', new Date('2026-10-17T06:00:00Z'))).toBe(false) // Saturday
  })

  it('picks the first recipient inside their own hours', () => {
    const picked = pickInWindow([{ email: 'a@x.co.uk' }, { email: 'b@x.in' }, { email: 'c@x.com', timezone: 'America/New_York' }], win, 'Europe/London', wed)
    expect(picked?.email).toBe('b@x.in')
    expect(pickInWindow([{ email: 'a@x.co.uk' }], win, 'Europe/London', wed)).toBeNull()
  })
})

describe('sequence step eligibility', () => {
  const steps = [
    { step_number: 2, delay_days: 3, subject: null, body: 'b2' },
    { step_number: 3, delay_days: 5, subject: 'New angle', body: 'b3' },
  ]
  const now = new Date('2026-10-14T12:00:00Z')
  const base = { id: '1', email: 'p@acme.com', status: 'sent', sent_at: '2026-10-10T12:00:00Z', current_step: 1 }
  const opts = { onlyDue: true, repliedDomains: new Set<string>(), now }

  it('makes step 2 due after its delay', () => {
    const r = checkStepEligibility(base, steps, opts)
    expect(r.eligible && r.step.step_number).toBe(2)
    expect(checkStepEligibility({ ...base, sent_at: '2026-10-13T12:00:00Z' }, steps, opts)).toEqual({ eligible: false, reason: 'not_due' })
  })

  it('counts later steps from the previous step', () => {
    expect(checkStepEligibility({ ...base, current_step: 2, last_step_sent_at: '2026-10-11T12:00:00Z' }, steps, opts)).toEqual({ eligible: false, reason: 'not_due' })
    const r = checkStepEligibility({ ...base, current_step: 2, last_step_sent_at: '2026-10-09T11:00:00Z' }, steps, opts)
    expect(r.eligible && r.step.step_number).toBe(3)
  })

  it('stops on reply, manual stop, last step, colleague reply and out-of-office hold', () => {
    expect(checkStepEligibility({ ...base, replied_at: 'x' }, steps, opts)).toEqual({ eligible: false, reason: 'replied' })
    expect(checkStepEligibility({ ...base, sequence_stopped: true }, steps, opts)).toEqual({ eligible: false, reason: 'stopped' })
    expect(checkStepEligibility({ ...base, current_step: 3 }, steps, opts)).toEqual({ eligible: false, reason: 'no_next_step' })
    expect(checkStepEligibility(base, steps, { ...opts, repliedDomains: new Set(['acme.com']) })).toEqual({ eligible: false, reason: 'colleague_replied' })
    const held = { ...base, next_step_not_before: '2026-10-20T00:00:00Z' }
    expect(checkStepEligibility(held, steps, opts)).toEqual({ eligible: false, reason: 'not_due' })
    expect(checkStepEligibility(held, steps, { ...opts, onlyDue: false })).toEqual({ eligible: false, reason: 'not_due' })
  })

  it('manual sends ignore the delay', () => {
    expect(checkStepEligibility({ ...base, sent_at: '2026-10-14T11:00:00Z' }, steps, { ...opts, onlyDue: false }).eligible).toBe(true)
  })

  it('does not treat free-mail replies as colleagues', () => {
    expect(companyDomainOf('x@gmail.com')).toBeNull()
  })

  it('builds subjects and validates steps', () => {
    expect(stepSubject(steps[0], 'Backend role')).toBe('Re: Backend role')
    expect(stepSubject(steps[0], 'RE: hi')).toBe('RE: hi')
    expect(stepSubject(steps[1], 'Backend role')).toBe('New angle')
    expect(normalizeSteps([{ delay_days: 0, body: 'x' }]).error).toBe('Step 2: delay must be between 1 and 60 days')
    expect(normalizeSteps([1, 2, 3, 4, 5].map(() => ({ delay_days: 2, body: 'x' }))).error).toBe('At most 4 follow-up steps')
    expect(normalizeSteps([{ delay_days: '4', subject: '  ', body: ' hi ' }]).steps).toEqual([{ step_number: 2, delay_days: 4, subject: null, body: 'hi' }])
  })
})
