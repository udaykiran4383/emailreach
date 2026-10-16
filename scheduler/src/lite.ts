import 'dotenv/config';
import { runEmailReachTick, getTickIntervalSeconds } from './lib/emailreach';
import { Logger } from './lib/logger';

/**
 * Lite mode: one process, no Kafka/etcd/Redis. Calls the EmailReach cron
 * endpoint every EMAILREACH_TICK_SECONDS. Run only one instance at a time.
 */
const logger = Logger.getInstance();
const intervalSeconds = getTickIntervalSeconds();

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (running) {
    logger.warn('Previous tick still running, skipping this one');
    return;
  }
  running = true;
  try {
    await runEmailReachTick();
  } catch (err) {
    logger.error('Tick failed', { error: (err as Error).message });
  } finally {
    running = false;
  }
}

function shutdown(signal: string): void {
  logger.info(`${signal} received, stopping lite scheduler`);
  if (timer) clearInterval(timer);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

logger.info(`Chronos lite started: ticking ${process.env.EMAILREACH_URL || 'http://localhost:3000'} every ${intervalSeconds}s`);
void tick();
timer = setInterval(() => void tick(), intervalSeconds * 1000);
