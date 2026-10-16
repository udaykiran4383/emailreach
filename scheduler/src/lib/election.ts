import { Etcd3, Lease } from 'etcd3';
import { Logger } from './logger';

const logger = Logger.getInstance();
const ELECTION_KEY = '/chronos/leader';
const LEASE_TTL = 30;

class LeaderElection {
  private client: Etcd3;
  private nodeId: string;
  private isLeader: boolean = false;
  private lease: Lease | null = null;
  private campaignInterval: NodeJS.Timeout | null = null;
  private static instance: LeaderElection;

  private constructor() {
    this.nodeId = `scheduler-${Math.random().toString(36).substring(7)}`;
    this.client = new Etcd3({
      hosts: process.env.ETCD_HOSTS || 'localhost:2379',
      grpcOptions: {
        'grpc.http2.max_pings_without_data': 0,
      },
    });
  }

  static getInstance(): LeaderElection {
    if (!LeaderElection.instance) {
      LeaderElection.instance = new LeaderElection();
    }
    return LeaderElection.instance;
  }

  async connect(): Promise<void> {
    // Test connection
    await this.client.get('test').exec();
    logger.info(`Leader Election initialized for node: ${this.nodeId}`);
  }

  async startCampaign(
    onBecomeLeader: () => Promise<void>,
    onLoseLeadership: () => Promise<void>
  ): Promise<void> {
    logger.info(`[${this.nodeId}] Campaigning for leadership...`);

    // Clear any existing interval
    if (this.campaignInterval) {
      clearInterval(this.campaignInterval);
    }

    // Campaign every 10 seconds
    this.campaignInterval = setInterval(async () => {
      try {
        await this.attemptLeadership(onBecomeLeader, onLoseLeadership);
      } catch (error) {
        logger.error('Election attempt failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 10000);

    // Try immediately
    await this.attemptLeadership(onBecomeLeader, onLoseLeadership);
  }

  private async attemptLeadership(
    onBecomeLeader: () => Promise<void>,
    onLoseLeadership: () => Promise<void>
  ): Promise<void> {
    try {
      const currentLeader = await this.client.get(ELECTION_KEY).string();

      if (currentLeader === this.nodeId) {
        // The lease is kept alive automatically while this process runs
        if (!this.isLeader) {
          this.isLeader = true;
          logger.info(`[${this.nodeId}] BECAME LEADER`);
          await onBecomeLeader();
        }
      } else if (!currentLeader) {
        if (!this.lease) {
          this.lease = this.client.lease(LEASE_TTL);
          this.lease.on('lost', (err) => {
            logger.warn(`[${this.nodeId}] Lease lost`, { error: err.message });
            this.lease = null;
            if (this.isLeader) {
              this.isLeader = false;
              void onLoseLeadership();
            }
          });
        }
        const leaseId = await this.lease.grant();

        // Atomic: only write the key if nobody created it in the meantime,
        // so two nodes can never both believe they are leader.
        const result = await this.client
          .if(ELECTION_KEY, 'Create', '==', 0)
          .then(this.client.put(ELECTION_KEY).value(this.nodeId).lease(leaseId))
          .commit();

        if (result.succeeded) {
          this.isLeader = true;
          logger.info(`[${this.nodeId}] BECAME LEADER (new)`);
          await onBecomeLeader();
        }
      } else if (this.isLeader) {
        this.isLeader = false;
        logger.info(`[${this.nodeId}] LOST LEADERSHIP`);
        await onLoseLeadership();
      }
    } catch (error) {
      if (this.isLeader) {
        this.isLeader = false;
        await onLoseLeadership();
      }
      logger.error('Election error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  async stopCampaign(): Promise<void> {
    if (this.campaignInterval) {
      clearInterval(this.campaignInterval);
    }
    const wasLeader = this.isLeader;
    this.isLeader = false;
    try {
      // Revoking the lease deletes the leader key, so a follower takes over immediately
      if (this.lease) {
        await this.lease.revoke();
        this.lease = null;
      } else if (wasLeader) {
        await this.client.delete().key(ELECTION_KEY).exec();
      }
    } catch (error) {
      logger.error('Error stopping campaign', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async disconnect(): Promise<void> {
    await this.stopCampaign();
    await this.client.close();
    logger.info('Leader election disconnected');
  }
}

export const election = LeaderElection.getInstance();
