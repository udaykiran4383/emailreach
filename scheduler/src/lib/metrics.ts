import * as client from 'prom-client';

class MetricsService {
  private register: client.Registry;
  private jobsSubmittedTotal: client.Counter;
  private jobsProcessedTotal: client.Counter;
  private jobsFailedTotal: client.Counter;
  private jobProcessingDuration: client.Histogram;
  private queueDepth: client.Gauge;
  private activeWorkers: client.Gauge;
  private leaderElectionChanges: client.Counter;
  private static instance: MetricsService;

  private constructor() {
    this.register = new client.Registry();

    // Counter: Total jobs submitted
    this.jobsSubmittedTotal = new client.Counter({
      name: 'chronos_jobs_submitted_total',
      help: 'Total number of jobs submitted via API',
      registers: [this.register],
    });

    // Counter: Total jobs processed
    this.jobsProcessedTotal = new client.Counter({
      name: 'chronos_jobs_processed_total',
      help: 'Total number of jobs successfully processed',
      registers: [this.register],
    });

    // Counter: Total jobs failed
    this.jobsFailedTotal = new client.Counter({
      name: 'chronos_jobs_failed_total',
      help: 'Total number of jobs that failed',
      registers: [this.register],
    });

    // Histogram: Job processing duration
    this.jobProcessingDuration = new client.Histogram({
      name: 'chronos_job_processing_duration_seconds',
      help: 'Time taken to process a job in seconds',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.register],
    });

    // Gauge: Queue depth
    this.queueDepth = new client.Gauge({
      name: 'chronos_queue_depth',
      help: 'Current number of jobs in the queue',
      registers: [this.register],
    });

    // Gauge: Active workers
    this.activeWorkers = new client.Gauge({
      name: 'chronos_active_workers',
      help: 'Number of active worker instances',
      registers: [this.register],
    });

    // Counter: Leader election changes
    this.leaderElectionChanges = new client.Counter({
      name: 'chronos_leader_election_changes_total',
      help: 'Total number of leader changes',
      registers: [this.register],
    });

    // Include default metrics
    client.collectDefaultMetrics({ register: this.register });
  }

  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  recordJobSubmitted(): void {
    this.jobsSubmittedTotal.inc();
  }

  recordJobProcessed(): void {
    this.jobsProcessedTotal.inc();
  }

  recordJobFailed(): void {
    this.jobsFailedTotal.inc();
  }

  recordJobProcessingTime(seconds: number): void {
    this.jobProcessingDuration.observe(seconds);
  }

  setQueueDepth(depth: number): void {
    this.queueDepth.set(depth);
  }

  setActiveWorkers(count: number): void {
    this.activeWorkers.set(count);
  }

  recordLeaderElectionChange(): void {
    this.leaderElectionChanges.inc();
  }

  async getMetrics(): Promise<string> {
    return await this.register.metrics();
  }

  getContentType(): string {
    return this.register.contentType;
  }
}

export const metrics = MetricsService.getInstance();
