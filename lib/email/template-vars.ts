/**
 * Template variable rendering shared by every email the app sends.
 * Pure (no I/O) so it can be unit-tested and reused in previews.
 */

export interface TemplateRecipient {
  email: string
  name?: string | null
  company?: string | null
  variables?: Record<string, unknown> | null
}

/** True when the stored name is just the email's local part (the upload fallback). */
function nameLooksLikeLocalPart(name: string, email: string): boolean {
  const local = email.split('@')[0].toLowerCase()
  const n = name.trim().toLowerCase()
  return n === local || (/[@\d_.]/.test(n) && !/\s/.test(n))
}

export function firstNameOf(name: string | null | undefined, email: string): string {
  if (!name || !name.trim()) return ''
  if (nameLooksLikeLocalPart(name, email)) return ''
  const first = name.trim().split(/\s+/)[0]
  // Shared inboxes are stored with the name "there" so greetings read "Hi there,"
  if (/^there$/i.test(first)) return 'there'
  // "J." or single letters read badly in a greeting
  if (first.replace(/\./g, '').length < 2) return ''
  return first.charAt(0).toUpperCase() + first.slice(1)
}

export function buildTemplateValues(recipient: TemplateRecipient): Record<string, string> {
  const values: Record<string, string> = {}

  // Custom variables first so the core fields below always win on conflicts
  for (const [key, value] of Object.entries(recipient.variables || {})) {
    if (value === null || value === undefined) continue
    values[key.toLowerCase()] = String(value).trim()
  }

  const name = (recipient.name || '').trim()
  values.name = name && !nameLooksLikeLocalPart(name, recipient.email) ? name : ''
  values.first_name = firstNameOf(recipient.name, recipient.email)
  values.email = recipient.email
  values.company = (recipient.company || '').trim()
  return values
}

/**
 * Replaces {{key}} (case-insensitive, spaces allowed inside braces). Unknown or empty
 * variables become '' so no literal braces are ever sent, then tidies the gaps they leave.
 */
export function renderTemplate(template: string, values: Record<string, string>, { singleLine = false } = {}): string {
  let out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key.toLowerCase()] ?? '')

  out = out
    .replace(/[ \t]{2,}/g, ' ')            // double spaces left by empty vars
    .replace(/ +([,.!?;:])/g, '$1')        // "Hi ," -> "Hi,"
    .replace(/[ \t]+$/gm, '')              // trailing spaces per line

  if (singleLine) return out.replace(/\s+/g, ' ').trim()

  // A line that only held an empty variable disappears instead of leaving a gap
  return out
    .split('\n')
    .filter((line, i, lines) => !(line.trim() === '' && i > 0 && lines[i - 1].trim() === ''))
    .join('\n')
    .trim()
}
