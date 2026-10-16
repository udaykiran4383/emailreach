import { Logger } from './logger';

const logger = Logger.getInstance();

export interface TickResult {
  scheduled_campaigns?: number;
  follow_ups?: number;
  replies_synced?: number;
  errors?: string[];
  [key: string]: unknown;
}

export function getTickIntervalSeconds(): number {
  const value = parseInt(process.env.EMAILREACH_TICK_SECONDS || '60', 10);
  return Number.isFinite(value) && value >= 10 ? value : 60;
}

function getConfig(): { url: string; secret: string } {
  const base = (process.env.EMAILREACH_URL || 'http://localhost:3000').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET || '';
  if (!secret) {
    throw new Error('CRON_SECRET is not set; EmailReach rejects unauthenticated cron calls');
  }
  return { url: `${base}/api/cron`, secret };
}

/**
 * Runs one EmailReach background tick (bounce scan, reply sync, drip sends,
 * due follow-ups). EmailReach itself enforces daily limits, send windows and
 * random delays, so calling this more often never sends faster than allowed.
 */
export async function runEmailReachTick(timeoutMs = 60000): Promise<TickResult> {
  const { url, secret } = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`EmailReach tick failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const result = (text ? JSON.parse(text) : {}) as TickResult;
    const meta: Record<string, unknown> = {
      campaigns: result.scheduled_campaigns ?? 0,
      followUps: result.follow_ups ?? 0,
      replies: result.replies_synced ?? 0,
    };
    if (result.errors?.length) meta.errors = result.errors;
    logger.info('EmailReach tick complete', meta);
    return result;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`EmailReach tick timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
