import { Kafka, Producer, Consumer, CompressionTypes } from 'kafkajs';
import { Logger } from './logger';

const logger = Logger.getInstance();
const TOPIC = 'chronos-jobs';

class QueueService {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private static instance: QueueService;

  private constructor() {
    this.kafka = new Kafka({
      clientId: 'chronos',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      connectionTimeout: 10000,
      requestTimeout: 30000,
      retry: {
        maxRetryTime: 30000,
        initialRetryTime: 100,
        retries: 8,
      },
    });
  }

  static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  async connectProducer(): Promise<void> {
    if (this.producer) return;
    
    this.producer = this.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 5,
    });
    
    await this.producer.connect();
    logger.info('Kafka Producer Connected');
  }

  async sendJob(job: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: Date;
  }): Promise<void> {
    if (!this.producer) {
      throw new Error('Producer not connected. Call connectProducer() first.');
    }

    await this.producer.send({
      topic: TOPIC,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: job.id,
          value: JSON.stringify(job),
          timestamp: Date.now().toString(),
        },
      ],
    });

    logger.debug(`Job ${job.id} sent to Kafka`, { jobType: job.type });
  }

  async startConsumer(
    messageHandler: (job: {
      id: string;
      type: string;
      payload: Record<string, unknown>;
      createdAt: Date;
    }) => Promise<void>,
    groupId: string = 'chronos-worker-group'
  ): Promise<void> {
    if (this.consumer) return;

    this.consumer = this.kafka.consumer({
      groupId,
      // EmailReach ticks can take up to ~3 min with retries; keep the session alive
      sessionTimeout: 240000,
      rebalanceTimeout: 300000,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    logger.info(`Kafka Consumer Connected (group: ${groupId})`);

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;

        try {
          const job = JSON.parse(message.value.toString());
          await messageHandler(job);
        } catch (error) {
          logger.error('Error processing message from Kafka', {
            error: error instanceof Error ? error.message : String(error),
            partition,
          });
        }
      },
    });
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
    logger.info('Kafka disconnected');
  }
}

export const queueService = QueueService.getInstance();
