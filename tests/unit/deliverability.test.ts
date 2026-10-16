import { describe, expect, it } from 'vitest'
import { DEFAULT_SENDER_SETTINGS, isWithinSendWindow, type SenderSettings } from '@/lib/email/deliverability'

const settings = (patch: Partial<SenderSettings> = {}): SenderSettings =>
  ({ ...DEFAULT_SENDER_SETTINGS, user_id: 'u1', next_send_at: null, timezone: 'Asia/Kolkata', send_window_start: 9, send_window_end: 18, skip_weekends: true, ...patch }) as SenderSettings

describe('isWithinSendWindow', () => {
  it('is open during local business hours', () => {
    // Wed 2026-10-14 06:00 UTC = 11:30 IST
    const r = isWithinSendWindow(settings(), new Date('2026-10-14T06:00:00Z'))
    expect(r.open).toBe(true)
    expect(r.localTime).toMatch(/^Wed 11:30/)
  })

  it('is closed before start and at/after end', () => {
    expect(isWithinSendWindow(settings(), new Date('2026-10-14T03:00:00Z')).open).toBe(false) // 08:30 IST
    expect(isWithinSendWindow(settings(), new Date('2026-10-14T12:30:00Z')).open).toBe(false) // 18:00 IST
  })

  it('skips weekends unless disabled', () => {
    const sat = new Date('2026-10-17T06:00:00Z')
    expect(isWithinSendWindow(settings(), sat)).toMatchObject({ open: false, message: expect.stringMatching(/Weekend/) })
    expect(isWithinSendWindow(settings({ skip_weekends: false }), sat).open).toBe(true)
  })

  it('uses the configured timezone', () => {
    // 06:00 UTC is 02:00 in New York
    expect(isWithinSendWindow(settings({ timezone: 'America/New_York' }), new Date('2026-10-14T06:00:00Z')).open).toBe(false)
  })

  it('has conservative defaults', () => {
    expect(DEFAULT_SENDER_SETTINGS.daily_limit).toBeLessThanOrEqual(50)
    expect(DEFAULT_SENDER_SETTINGS.min_delay_seconds).toBeGreaterThanOrEqual(30)
    expect(DEFAULT_SENDER_SETTINGS.warmup_enabled).toBe(true)
  })
})
