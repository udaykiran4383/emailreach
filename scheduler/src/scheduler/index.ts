import 'dotenv/config';
import express, { Express, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queueService } from '../lib/queue';
import { election } from '../lib/election';
import { redisService } from '../lib/redis';
import { metrics } from '../lib/metrics';
import { Logger } from '../lib/logger';
import { getTickIntervalSeconds } from '../lib/emailreach';

const logger = Logger.getInstance();
const app: Express = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3001', 10);
const NODE_ID = `scheduler-${Math.random().toString(36).slice(2, 8)}`;
const TICK_SECONDS = getTickIntervalSeconds();

let isLeader = false;
let schedulerLoop: NodeJS.Timeout | null = null;

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`, { nodeId: NODE_ID });
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    nodeId: NODE_ID,
    isLeader,
    timestamp: new Date().toISOString(),
  });
});

// Submit job
app.post('/submit', async (req: Request, res: Response) => {
  try {
    const { type, payload } = req.body;

    if (!type || !payload) {
      return res.status(400).json({ error: 'Missing type or payload' });
    }

    const jobId = uuidv4();
    const job = { id: jobId, type, payload, createdAt: new Date() };

    if (await redisService.jobExists(jobId)) {
      return res.status(409).json({ error: 'Duplicate job', jobId });
    }

    await redisService.markJobQueued(jobId);
    await queueService.sendJob(job);
    await redisService.recordJob(job);
    metrics.recordJobSubmitted();

    logger.info(`Job submitted: ${jobId}`, { type, nodeId: NODE_ID });

    res.status(202).json({ status: 'queued', jobId });
  } catch (err) {
    logger.error('Submit failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to submit job' });
  }
});

// List recent jobs with current status
app.get('/jobs', async (_req, res) => {
  try {
    const jobs = await redisService.getRecentJobs();

    const enriched = await Promise.all(
      jobs.map(async (job: any) => ({
        ...job,
        status: (await redisService.getJobStatus(job.id)) || 'unknown',
      }))
    );

    res.json(enriched);
  } catch (err) {
    logger.error('Failed to list jobs', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Get single job status
app.get('/jobs/:jobId', async (req, res) => {
  try {
    const status = await redisService.getJobStatus(req.params.jobId);

    if (!status) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ jobId: req.params.jobId, status, checkedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Status check failed', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Node status
app.get('/status', (_req, res) => {
  res.json({
    nodeId: NODE_ID,
    isLeader,
    role: isLeader ? 'LEADER' : 'FOLLOWER',
    timestamp: new Date().toISOString(),
  });
});

// Prometheus metrics
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', metrics.getContentType());
    res.send(await metrics.getMetrics());
  } catch (err) {
    res.status(500).send('Metrics error');
  }
});

/**
 * Dispatches one EmailReach tick per time window. The job id is derived from
 * the window, and Redis SET NX makes the claim atomic, so a leader failover in
 * the middle of a window never dispatches the same tick twice.
 */
async function dispatchEmailReachTick(): Promise<void> {
  const window = Math.floor(Date.now() / (TICK_SECONDS * 1000));
  const jobId = `emailreach-tick-${window}`;

  if (!(await redisService.claimJob(jobId, TICK_SECONDS * 10))) return;

  const job = { id: jobId, type: 'emailreach-tick', payload: { window }, createdAt: new Date() };
  await queueService.sendJob(job);
  await redisService.recordJob(job);
  metrics.recordJobSubmitted();
  logger.info(`Dispatched ${jobId}`);
}

// Leadership callbacks
async function onBecomeLeader(): Promise<void> {
  isLeader = true;
  metrics.recordLeaderElectionChange();
  logger.warn(`[${NODE_ID}] Became leader`);

  if (schedulerLoop) clearInterval(schedulerLoop);

  schedulerLoop = setInterval(async () => {
    if (!isLeader) {
      clearInterval(schedulerLoop!);
      schedulerLoop = null;
      return;
    }

    try {
      await dispatchEmailReachTick();
    } catch (err) {
      logger.error('Scheduler loop error', { error: (err as Error).message });
    }
  }, 5000);
}

async function onLoseLeadership(): Promise<void> {
  isLeader = false;
  logger.warn(`[${NODE_ID}] Lost leadership`);

  if (schedulerLoop) {
    clearInterval(schedulerLoop);
    schedulerLoop = null;
  }
}

// Startup
async function start(): Promise<void> {
  try {
    logger.info(`Starting scheduler (node: ${NODE_ID})`);

    await election.connect();
    await redisService.connect();
    await queueService.connectProducer();

    app.listen(PORT, () => {
      logger.info(`API listening on port ${PORT}`);
    });

    await election.startCampaign(onBecomeLeader, onLoseLeadership);
  } catch (err) {
    logger.error('Startup failed', { error: (err as Error).message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');

  if (schedulerLoop) clearInterval(schedulerLoop);

  try {
    await election.stopCampaign();
    await election.disconnect();
    await redisService.disconnect();
    await queueService.disconnect();
  } catch (err) {
    logger.error('Shutdown error', { error: (err as Error).message });
  }

  process.exit(0);
});

start().catch((err) => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
