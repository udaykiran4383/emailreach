import Anthropic from '@anthropic-ai/sdk'

/**
 * Shared Anthropic client. Credentials and base URL come from the SDK's own
 * env handling (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL),
 * so tests can point ANTHROPIC_BASE_URL at a mock server.
 */

export const AI_MODELS = {
  // Writes the personalized opener line (quality matters, low volume)
  write: process.env.AI_MODEL_WRITE || 'claude-sonnet-5-5',
  // Classifies incoming replies (high volume, simple task)
  classify: process.env.AI_MODEL_CLASSIFY || 'claude-haiku-5-5',
}

/** AI features are optional: without credentials the app falls back to rules or reports AI_DISABLED. */
export function isAiEnabled(): boolean {
  if (process.env.AI_DISABLED === 'true') return false
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
}

let client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ maxRetries: 2, timeout: 30_000 })
  }
  return client
}

/** Wraps untrusted text (web pages, emails) so the model treats it as data, never as instructions. */
export function untrusted(tag: string, text: string): string {
  // Neutralize attempts to close the wrapper tag from inside the content
  const safe = text.replace(new RegExp(`</?${tag}>`, 'gi'), '')
  return `<${tag}>\n${safe}\n</${tag}>`
}
