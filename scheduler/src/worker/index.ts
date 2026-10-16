import 'dotenv/config';
import { queueService } from '../lib/queue';
import { redisService } from '../lib/redis';
import { metrics } from '../lib/metrics';
import { Logger } from '../lib/logger';
import { runEmailReachTick } from '../lib/emailreach';

const logger = Logger.getInstance();
const WORKER_ID = `worker-${Math.random().toString(36).slice(2, 8)}`;
const MAX_ATTEMPTS = 3;

interface JobPayload {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

type JobHandler = (job: JobPayload) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  // One EmailReach background tick: bounce scan, reply sync, drip sends, follow-ups.
  // 'email' is kept as an alias so jobs submitted via POST /submit trigger a real tick.
  'emailreach-tick': async () => {
    await runEmailReachTick();
  },
  email: async () => {
    await runEmailReachTick();
  },
};

async function handleJob(job: JobPayload): Promise<void> {
  const handler = handlers[job.type];
  if (!handler) {
    logger.warn(`Unknown job type, skipping [${job.id}]`, { type: job.type, worker: WORKER_ID });
    await redisService.markJobFailed(job.id);
    metrics.recordJobFailed();
    return;
  }

  const start = Date.now();
  logger.info(`Processing [${job.id}]`, { type: job.type, worker: WORKER_ID });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await handler(job);
      await redisService.markJobCompleted(job.id);

      const elapsed = (Date.now() - start) / 1000;
      metrics.recordJobProcessed();
      metrics.recordJobProcessingTime(elapsed);
      logger.info(`Done [${job.id}]`, { duration: `${elapsed.toFixed(2)}s`, worker: WORKER_ID, attempt });
      return;
    } catch (err) {
      const message = (err as Error).message;
      if (attempt === MAX_ATTEMPTS) {
        metrics.recordJobFailed();
        await redisService.markJobFailed(job.id).catch(() => undefined);
        logger.error(`Failed [${job.id}] after ${attempt} attempts`, { error: message, worker: WORKER_ID, type: job.type });
        return;
      }
      const backoffMs = 2 ** attempt * 1000;
      logger.warn(`Attempt ${attempt} failed [${job.id}], retrying in ${backoffMs / 1000}s`, { error: message, worker: WORKER_ID });
      await delay(backoffMs);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function start(): Promise<void> {
  try {
    logger.info(`Worker starting (${WORKER_ID})`);

    await redisService.connect();
    await queueService.startConsumer(handleJob);

    logger.info('Worker ready', { worker: WORKER_ID });
  } catch (err) {
    logger.error('Startup failed', { error: (err as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');

  try {
    await redisService.disconnect();
    await queueService.disconnect();
  } catch (err) {
    logger.error('Shutdown error', { error: (err as Error).message });
  }

  process.exit(0);
});

start().catch((err) => {
  logger.error('Fatal', { error: err.message });
  process.exit(1);
});
