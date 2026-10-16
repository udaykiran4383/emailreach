#!/usr/bin/env node
/**
 * EmailReach MCP server (stdio). Gives Claude read access to campaigns,
 * pipeline and replies, plus the contact finder, job search and adding
 * recipients — all through the EmailReach HTTP API with a personal API token.
 *
 * It cannot send email or touch Gmail: the API token is only accepted on an
 * allowlist of routes (lib/api-token-routes.ts in the app).
 *
 * Env: EMAILREACH_URL (default http://localhost:3000), EMAILREACH_TOKEN (erk_…)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE_URL = (process.env.EMAILREACH_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN = process.env.EMAILREACH_TOKEN || ''
const REQUEST_TIMEOUT_MS = 90_000
const MAX_OUTPUT_CHARS = 60_000

class ApiError extends Error {}

async function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  if (!TOKEN) throw new ApiError('EMAILREACH_TOKEN is not set. Create one in EmailReach → Settings → API tokens.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (res.status >= 300 && res.status < 400) {
      throw new ApiError(`EmailReach redirected to ${res.headers.get('location')} — is the token valid and the app up to date?`)
    }
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // keep text
    }
    if (!res.ok) {
      const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : text.slice(0, 300)
      throw new ApiError(`${method} ${path} failed (${res.status}): ${message}`)
    }
    return data
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error).name === 'AbortError') throw new ApiError(`${method} ${path} timed out`)
    throw new ApiError(`Could not reach EmailReach at ${BASE_URL}: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

function result(data: unknown) {
  let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  if (text.length > MAX_OUTPUT_CHARS) text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)`
  return { content: [{ type: 'text' as const, text }] }
}

function failure(err: unknown) {
  return { content: [{ type: 'text' as const, text: (err as Error).message }], isError: true }
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return result(await fn())
  } catch (err) {
    return failure(err)
  }
}

const server = new McpServer({ name: 'emailreach', version: '0.1.0' })

server.registerTool(
  'list_campaigns',
  {
    title: 'List campaigns',
    description: 'List the user’s EmailReach campaigns with status and sent/recipient counts.',
    annotations: { readOnlyHint: true },
  },
  () => run(() => api('GET', '/api/campaigns'))
)

server.registerTool(
  'get_campaign_stats',
  {
    title: 'Campaign stats',
    description: 'Sent, replies, opens, bounces and pending counts for one campaign, plus the most recent recipients.',
    inputSchema: {
      campaignId: z.string().uuid().describe('Campaign id from list_campaigns'),
      includeRecipients: z.number().int().min(0).max(200).default(25).describe('How many recipient rows to include'),
    },
    annotations: { readOnlyHint: true },
  },
  ({ campaignId, includeRecipients }) =>
    run(async () => {
      const data = (await api('GET', `/api/campaigns/${campaignId}/analytics`)) as Record<string, unknown>
      const { logs, skippedLogs, ...totals } = data
      return {
        ...totals,
        recipients: Array.isArray(logs) ? logs.slice(0, includeRecipients) : [],
        skipped: Array.isArray(skippedLogs) ? skippedLogs.length : 0,
      }
    })
)

server.registerTool(
  'find_contacts',
  {
    title: 'Find HR & leaders',
    description:
      'Find HR/recruiters, tech leads, CTOs and CEOs at up to 3 companies from their public websites (and Hunter.io if configured). ' +
      'Only contacts with verification.status "safe" will actually be emailed by campaigns.',
    inputSchema: {
      companies: z.array(z.string().min(3)).min(1).max(3).describe('Company websites or domains, e.g. "acme.com"'),
      roles: z.array(z.enum(['hr', 'tech_lead', 'ceo', 'cto'])).default([]).describe('Empty = all roles'),
      verify: z.boolean().default(true),
      guessPatterns: z.boolean().default(true),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  (args) => run(() => api('POST', '/api/find-contacts', args))
)

server.registerTool(
  'search_jobs',
  {
    title: 'Search open jobs',
    description: 'Search open roles at target companies (public Greenhouse / Lever / Ashby job boards).',
    inputSchema: {
      companies: z.array(z.string()).min(1).max(5).describe('Company domains or websites (max 5 per call)'),
      keywords: z.array(z.string()).max(10).optional().describe('Role keywords, e.g. ["backend", "intern"]'),
      seniority: z
        .array(z.enum(['intern', 'new_grad', 'junior', 'mid', 'senior']))
        .optional()
        .describe('Only keep roles at these levels'),
      location: z.string().optional(),
      remote: z.boolean().optional().describe('Only remote roles'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ companies, keywords, seniority, location, remote }) =>
    run(() =>
      api('POST', '/api/jobs/search', {
        companies,
        keywords: (keywords || []).join(', '),
        seniority,
        location,
        remoteOnly: remote ?? false,
      })
    )
)

server.registerTool(
  'add_recipients',
  {
    title: 'Add recipients to a campaign',
    description:
      'Add contacts to a campaign. Duplicates and blocked (bounced/unsubscribed) addresses are skipped. ' +
      'This does not send anything — sending is started by the user in the app.',
    inputSchema: {
      campaignId: z.string().uuid(),
      recipients: z
        .array(
          z.object({
            email: z.string().email(),
            name: z.string().optional(),
            company: z.string().optional(),
            verification_status: z.enum(['safe', 'risky', 'invalid']).optional(),
            verification_reason: z.string().optional(),
          })
        )
        .min(1)
        .max(500),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  ({ campaignId, recipients }) => run(() => api('POST', `/api/campaigns/${campaignId}/recipients`, { recipients }))
)

server.registerTool(
  'get_pipeline',
  {
    title: 'Application pipeline',
    description: 'The job-application pipeline: companies by stage (contacted, replied, interview, offer, rejected).',
    annotations: { readOnlyHint: true },
  },
  () => run(() => api('GET', '/api/pipeline'))
)

server.registerTool(
  'list_replies',
  {
    title: 'List replies',
    description: 'Recent replies to the user’s outreach, with their classification (interview, referral, not hiring, …).',
    inputSchema: {
      campaignId: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ campaignId }) => run(() => api('GET', `/api/replies${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`))
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the MCP channel: log to stderr only
  console.error(`[emailreach-mcp] ready (${BASE_URL})`)
}

main().catch((err) => {
  console.error('[emailreach-mcp] fatal:', err)
  process.exit(1)
})
