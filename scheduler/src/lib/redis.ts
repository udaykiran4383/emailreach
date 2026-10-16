import { createClient, RedisClientType } from 'redis';
import { Logger } from './logger';

const logger = Logger.getInstance();

const JOB_KEY_PREFIX = 'job:';
const LOCK_KEY_PREFIX = 'lock:';
const RECENT_JOBS_KEY = 'recent_jobs';
const MAX_RECENT_JOBS = 100;

class RedisService {
  private client: RedisClientType | null = null;
  private static instance: RedisService;

  private constructor() { }

  static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService();
    }
    return RedisService.instance;
  }

  async connect(): Promise<void> {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries: number) => Math.min(retries * 50, 500),
      },
    });

    this.client.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    this.client.on('connect', () => logger.info('Redis connected'));

    await this.client.connect();
  }

  private ensureConnected(): void {
    if (!this.client) throw new Error('Redis not connected');
  }

  // Job state management
  async jobExists(jobId: string): Promise<boolean> {
    this.ensureConnected();
    return !!(await this.client!.get(JOB_KEY_PREFIX + jobId));
  }

  async markJobQueued(jobId: string, ttlSeconds = 3600): Promise<void> {
    this.ensureConnected();
    await this.client!.setEx(JOB_KEY_PREFIX + jobId, ttlSeconds, 'queued');
  }

  /**
   * Atomically marks a job as queued only if it has never been seen (SET NX).
   * Returns false when another node already claimed this job id.
   */
  async claimJob(jobId: string, ttlSeconds = 3600): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client!.set(JOB_KEY_PREFIX + jobId, 'queued', { NX: true, EX: ttlSeconds });
    return result !== null;
  }

  async markJobFailed(jobId: string, ttlSeconds = 86400): Promise<void> {
    this.ensureConnected();
    await this.client!.setEx(JOB_KEY_PREFIX + jobId, ttlSeconds, 'failed');
  }

  async markJobCompleted(jobId: string, ttlSeconds = 86400): Promise<void> {
    this.ensureConnected();
    await this.client!.setEx(JOB_KEY_PREFIX + jobId, ttlSeconds, 'completed');
  }

  async getJobStatus(jobId: string): Promise<string | null> {
    this.ensureConnected();
    return this.client!.get(JOB_KEY_PREFIX + jobId);
  }

  // Job history for dashboard
  async recordJob(job: Record<string, unknown>): Promise<void> {
    this.ensureConnected();
    await this.client!
      .multi()
      .lPush(RECENT_JOBS_KEY, JSON.stringify(job))
      .lTrim(RECENT_JOBS_KEY, 0, MAX_RECENT_JOBS - 1)
      .exec();
  }

  async getRecentJobs(): Promise<Record<string, unknown>[]> {
    this.ensureConnected();
    const raw = await this.client!.lRange(RECENT_JOBS_KEY, 0, -1);
    return raw.map((entry) => JSON.parse(entry));
  }

  // Simple counters
  async incrementCounter(key: string): Promise<number> {
    this.ensureConnected();
    return this.client!.incr(key);
  }

  async getCounter(key: string): Promise<number> {
    this.ensureConnected();
    const val = await this.client!.get(key);
    return parseInt(val || '0', 10);
  }

  // Distributed locking
  async acquireLock(key: string, ttlSeconds = 10): Promise<boolean> {
    this.ensureConnected();
    const result = await this.client!.set(LOCK_KEY_PREFIX + key, 'locked', {
      NX: true,
      EX: ttlSeconds,
    });
    return result !== null;
  }

  async releaseLock(key: string): Promise<void> {
    this.ensureConnected();
    await this.client!.del(LOCK_KEY_PREFIX + key);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      logger.info('Redis disconnected');
    }
  }
}

export const redisService = RedisService.getInstance();
