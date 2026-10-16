/**
 * Recipient timezone guessing and per-timezone sending windows. Pure (no I/O).
 * The guess comes from the email domain's country-code TLD; generic TLDs
 * (.com, .io ...) fall back to the sender's own timezone.
 */

const CCTLD_TIMEZONES: Record<string, string> = {
  in: 'Asia/Kolkata',
  uk: 'Europe/London',
  ie: 'Europe/Dublin',
  de: 'Europe/Berlin',
  at: 'Europe/Vienna',
  ch: 'Europe/Zurich',
  fr: 'Europe/Paris',
  be: 'Europe/Brussels',
  nl: 'Europe/Amsterdam',
  es: 'Europe/Madrid',
  it: 'Europe/Rome',
  pt: 'Europe/Lisbon',
  se: 'Europe/Stockholm',
  no: 'Europe/Oslo',
  dk: 'Europe/Copenhagen',
  fi: 'Europe/Helsinki',
  pl: 'Europe/Warsaw',
  cz: 'Europe/Prague',
  sg: 'Asia/Singapore',
  my: 'Asia/Kuala_Lumpur',
  id: 'Asia/Jakarta',
  ph: 'Asia/Manila',
  th: 'Asia/Bangkok',
  vn: 'Asia/Ho_Chi_Minh',
  hk: 'Asia/Hong_Kong',
  cn: 'Asia/Shanghai',
  tw: 'Asia/Taipei',
  jp: 'Asia/Tokyo',
  kr: 'Asia/Seoul',
  ae: 'Asia/Dubai',
  sa: 'Asia/Riyadh',
  qa: 'Asia/Qatar',
  il: 'Asia/Jerusalem',
  pk: 'Asia/Karachi',
  bd: 'Asia/Dhaka',
  lk: 'Asia/Colombo',
  np: 'Asia/Kathmandu',
  au: 'Australia/Sydney',
  nz: 'Pacific/Auckland',
  ca: 'America/Toronto',
  us: 'America/New_York',
  mx: 'America/Mexico_City',
  br: 'America/Sao_Paulo',
  ar: 'America/Argentina/Buenos_Aires',
  cl: 'America/Santiago',
  co: 'America/Bogota',
  za: 'Africa/Johannesburg',
  ng: 'Africa/Lagos',
  ke: 'Africa/Nairobi',
  eg: 'Africa/Cairo',
}

export function guessTimezoneFromEmail(email: string, fallback: string): string {
  const domain = email.split('@')[1]?.toLowerCase().trim() || ''
  const tld = domain.split('.').pop() || ''
  return CCTLD_TIMEZONES[tld] || fallback
}

export interface SendWindow {
  send_window_start: number // local hour, inclusive
  send_window_end: number   // local hour, exclusive
  skip_weekends: boolean
}

export function localDayAndHour(timezone: string, now: Date = new Date()): { weekday: string; hour: number; minute: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  return {
    weekday: parts.find(p => p.type === 'weekday')?.value || '',
    hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10),
    minute: parts.find(p => p.type === 'minute')?.value || '00',
  }
}

export function isInWindow(window: SendWindow, timezone: string, now: Date = new Date()): boolean {
  let local
  try {
    local = localDayAndHour(timezone, now)
  } catch {
    return false // invalid timezone string
  }
  if (window.skip_weekends && (local.weekday === 'Sat' || local.weekday === 'Sun')) return false
  return local.hour >= window.send_window_start && local.hour < window.send_window_end
}

export function recipientTimezone(recipient: { email: string; timezone?: string | null }, fallback: string): string {
  return recipient.timezone || guessTimezoneFromEmail(recipient.email, fallback)
}

/** First candidate whose local time is inside the sending window, or null. */
export function pickInWindow<T extends { email: string; timezone?: string | null }>(
  candidates: T[],
  window: SendWindow,
  fallbackTimezone: string,
  now: Date = new Date()
): T | null {
  return candidates.find(c => isInWindow(window, recipientTimezone(c, fallbackTimezone), now)) || null
}
