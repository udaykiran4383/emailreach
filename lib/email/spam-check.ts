/**
 * Lightweight content linter for cold emails. Pure function, no dependencies.
 * It flags content patterns that spam filters and recipients react badly to;
 * it can't guarantee inbox placement (sender reputation matters more).
 */

export type IssueSeverity = 'high' | 'medium' | 'low'

export interface ContentIssue {
  severity: IssueSeverity
  message: string
  fix: string
}

export interface ContentAnalysis {
  score: number
  level: 'good' | 'ok' | 'risky'
  issues: ContentIssue[]
}

const SPAM_PHRASES = [
  'free money', 'guaranteed', 'guarantee', 'act now', '100%', 'urgent', 'winner', 'you have been selected',
  'click here', 'click below', 'limited time', 'risk-free', 'risk free', '$$$', 'earn', 'cash', 'cash bonus',
  'make money', 'double your', 'no cost', 'no obligation', 'free trial', 'free gift', 'buy now', 'order now',
  'special promotion', 'exclusive deal', 'once in a lifetime', 'congratulations', 'dear friend', 'credit card',
  'lowest price', 'best price', 'miracle', 'amazing', 'incredible deal', 'cheap', 'discount', 'offer expires',
  'apply now', 'call now', 'instant', 'winning', 'prize', 'bonus', 'investment', 'income', 'extra income',
  'work from home', 'million dollars', 'no catch', 'no strings attached', 'satisfaction guaranteed',
  'unsubscribe', 'this is not spam', 'not spam', 'viagra', 'casino', 'loan', 'debt', 'crypto',
]

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'rebrand.ly', 'cutt.ly', 'is.gd', 'buff.ly', 'shorturl.at', 'tiny.cc']

const SIGN_OFFS = /(regards|best|thanks|thank you|cheers|sincerely|warmly|respectfully|yours)[,!.]?\s*$/im

const PENALTY: Record<IssueSeverity, number> = { high: 20, medium: 10, low: 4 }

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseRegex(phrase: string) {
  const escaped = escapeRegex(phrase)
  const start = /^\w/.test(phrase) ? '\\b' : ''
  const end = /\w$/.test(phrase) ? '\\b' : ''
  return new RegExp(`${start}${escaped}${end}`, 'i')
}

export function analyzeEmailContent({
  subject,
  body,
  hasAttachment = false,
  trackOpens = false,
}: {
  subject: string
  body: string
  hasAttachment?: boolean
  trackOpens?: boolean
}): ContentAnalysis {
  const issues: ContentIssue[] = []
  const subj = (subject || '').trim()
  const text = body || ''
  const plain = text.replace(/<[^>]+>/g, ' ')
  const combined = `${subj}\n${plain}`

  // Spam trigger phrases
  const hits = SPAM_PHRASES.filter((p) => phraseRegex(p).test(combined))
  if (hits.length > 0) {
    issues.push({
      severity: hits.length >= 3 ? 'high' : 'medium',
      message: `Spam trigger words: ${hits.slice(0, 8).map((h) => `"${h}"`).join(', ')}${hits.length > 8 ? '…' : ''}`,
      fix: 'Rephrase these in plain, specific language — write like a normal 1:1 email.',
    })
  }

  // ALL CAPS words
  const words = combined.match(/\b[A-Za-z]{3,}\b/g) || []
  const capsWords = words.filter((w) => w === w.toUpperCase())
  if (words.length > 0 && capsWords.length / words.length > 0.1 && capsWords.length >= 3) {
    issues.push({
      severity: 'medium',
      message: `${capsWords.length} words in ALL CAPS`,
      fix: 'Use normal sentence case; capitals read as shouting and trigger filters.',
    })
  }

  // Exclamation marks
  const subjectBangs = (subj.match(/!/g) || []).length
  if (subjectBangs > 1 || /!!/.test(combined)) {
    issues.push({
      severity: 'medium',
      message: 'Multiple exclamation marks',
      fix: 'Use at most one "!" in the body and none in the subject.',
    })
  }

  // Subject checks
  if (subj.length < 3) {
    issues.push({ severity: 'high', message: 'Subject is missing or too short', fix: 'Write a short, specific subject (3–8 words).' })
  } else if (subj.length > 70) {
    issues.push({ severity: 'low', message: `Subject is long (${subj.length} chars)`, fix: 'Keep it under ~60 characters so it isn’t truncated.' })
  }
  const subjLetters = subj.replace(/[^A-Za-z]/g, '')
  if (subjLetters.length >= 4 && subjLetters === subjLetters.toUpperCase()) {
    issues.push({ severity: 'high', message: 'Subject is in ALL CAPS', fix: 'Use sentence case for the subject.' })
  }
  if (/^\s*(re|fwd?|fw)\s*:/i.test(subj)) {
    issues.push({
      severity: 'high',
      message: 'Subject starts with "Re:"/"Fwd:" on a first email',
      fix: 'Fake reply prefixes are a classic spam tactic — remove them.',
    })
  }

  // Links
  const urls = combined.match(/https?:\/\/[^\s<>"')]+/gi) || []
  if (urls.length > 2) {
    issues.push({ severity: 'medium', message: `${urls.length} links in the email`, fix: 'Keep cold emails to 1–2 links (e.g. LinkedIn or portfolio).' })
  }
  const shortened = urls.filter((u) => SHORTENERS.some((s) => new RegExp(`^https?://(www\\.)?${escapeRegex(s)}/`, 'i').test(u)))
  if (shortened.length > 0) {
    issues.push({ severity: 'high', message: 'Uses a URL shortener', fix: 'Use the full destination URL; shorteners are heavily abused by spammers.' })
  }
  for (const m of text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const linkText = m[2].replace(/<[^>]+>/g, '').trim()
    const textUrl = linkText.match(/https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i)?.[0]
    if (textUrl) {
      try {
        const hrefHost = new URL(m[1]).hostname.replace(/^www\./, '')
        const textHost = new URL(/^https?:/i.test(textUrl) ? textUrl : `https://${textUrl}`).hostname.replace(/^www\./, '')
        if (hrefHost !== textHost) {
          issues.push({ severity: 'high', message: `Link text shows ${textHost} but points to ${hrefHost}`, fix: 'Make the visible URL match the real destination.' })
          break
        }
      } catch {
        /* ignore malformed */
      }
    }
  }

  // Images / HTML heavy
  const imgCount = (text.match(/<img\b/gi) || []).length
  const tagCount = (text.match(/<[a-z][^>]*>/gi) || []).length
  if (imgCount > 0) {
    issues.push({ severity: 'medium', message: `${imgCount} image(s) in the body`, fix: 'Plain-text style emails land in the inbox more often; drop images.' })
  } else if (tagCount > 15) {
    issues.push({ severity: 'low', message: 'Body is HTML-heavy', fix: 'Keep formatting minimal — it should look like a personal email.' })
  }

  // Length
  const wordCount = (plain.match(/\S+/g) || []).length
  if (wordCount < 40) {
    issues.push({ severity: 'low', message: `Body is very short (${wordCount} words)`, fix: 'Aim for 50–150 words with a clear reason for reaching out.' })
  } else if (wordCount > 300) {
    issues.push({ severity: 'medium', message: `Body is long (${wordCount} words)`, fix: 'Cut to under ~200 words; long cold emails get ignored or flagged.' })
  }

  // Personalization
  if (!/\{\{\s*(?:first_)?name\s*\}\}/i.test(combined)) {
    issues.push({ severity: 'medium', message: 'No {{first_name}} / {{name}} personalization', fix: 'Greet each person by name, e.g. "Hi {{first_name}},".' })
  }
  const oddPlaceholders = [
    ...(combined.match(/(?<!\{)\{\s*[a-z_]+\s*\}(?!\})/gi) || []),
    ...(combined.match(/\[(?:name|first ?name|company|role|your name)\]/gi) || []),
  ]
  if (oddPlaceholders.length > 0) {
    issues.push({
      severity: 'high',
      message: `Unreplaced placeholder(s): ${[...new Set(oddPlaceholders)].slice(0, 4).join(', ')}`,
      fix: 'Use double braces like {{name}} / {{company}} — single braces and [Name] are sent as-is.',
    })
  }

  // Attachment on first email
  if (hasAttachment) {
    issues.push({
      severity: 'medium',
      message: 'Attachment on a first cold email',
      fix: 'Consider a link to your resume instead, or send the attachment only after they reply.',
    })
  }

  if (trackOpens) {
    issues.push({ severity: 'low', message: 'Open-tracking pixel enabled', fix: 'Pixels slightly raise spam risk; disable for your most important sends.' })
  }

  // Emojis
  const emojiCount = (combined.match(/\p{Extended_Pictographic}/gu) || []).length
  if (emojiCount > 2) {
    issues.push({ severity: 'low', message: `${emojiCount} emojis`, fix: 'Use at most one emoji in a professional cold email.' })
  }

  // Sign-off
  const lastLines = plain.trim().split('\n').slice(-4).join('\n')
  if (plain.trim().length > 0 && !SIGN_OFFS.test(lastLines) && !SIGN_OFFS.test(plain.trim().split('\n').slice(-3, -1).join('\n'))) {
    issues.push({ severity: 'low', message: 'No sign-off found', fix: 'End with a sign-off and your name (e.g. "Best," then your name).' })
  }

  const order: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])

  const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + PENALTY[i.severity], 0))
  const hasHigh = issues.some((i) => i.severity === 'high')
  const level: ContentAnalysis['level'] = score >= 80 && !hasHigh ? 'good' : score >= 60 ? 'ok' : 'risky'

  return { score, level, issues }
}
