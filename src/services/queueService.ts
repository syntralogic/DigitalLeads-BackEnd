import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class QueueService {
  private static readonly QUEUES = {
    email: 'email:queue',
    telegram: 'telegram:queue',
    analytics: 'analytics:queue',
    postback: 'postback:queue',
    fraud: 'fraud:queue',
  };

  static async push(queue: keyof typeof this.QUEUES, data: any): Promise<void> {
    try {
      const queueName = this.QUEUES[queue];
      await redis.lpush(queueName, JSON.stringify(data));
      logger.debug(`Pushed to queue ${queueName}`, { data });
    } catch (error) {
      logger.error(`Failed to push to queue ${queue}:`, error);
      throw error;
    }
  }

  static async pop(queue: keyof typeof this.QUEUES): Promise<any | null> {
    try {
      const queueName = this.QUEUES[queue];
      const result = await redis.rpop(queueName);
      if (result) {
        return JSON.parse(result);
      }
      return null;
    } catch (error) {
      logger.error(`Failed to pop from queue ${queue}:`, error);
      return null;
    }
  }

  static async length(queue: keyof typeof this.QUEUES): Promise<number> {
    try {
      const queueName = this.QUEUES[queue];
      return await redis.llen(queueName);
    } catch (error) {
      logger.error(`Failed to get queue length for ${queue}:`, error);
      return 0;
    }
  }

  static async clear(queue: keyof typeof this.QUEUES): Promise<void> {
    try {
      const queueName = this.QUEUES[queue];
      await redis.del(queueName);
    } catch (error) {
      logger.error(`Failed to clear queue ${queue}:`, error);
    }
  }

  // Process queue with concurrency
  static async process(
    queue: keyof typeof this.QUEUES,
    handler: (data: any) => Promise<void>,
    concurrency: number = 5
  ): Promise<void> {
    const queueName = this.QUEUES[queue];
    logger.info(`Starting queue processor for ${queueName} with concurrency ${concurrency}`);

    const workers: Promise<void>[] = [];

    for (let i = 0; i < concurrency; i++) {
      workers.push(this.processWorker(queueName, handler));
    }

    await Promise.all(workers);
  }

  private static async processWorker(
    queueName: string,
    handler: (data: any) => Promise<void>
  ): Promise<void> {
    while (true) {
      try {
        const result = await redis.rpop(queueName);
        if (!result) {
          // No items, wait a bit
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        const data = JSON.parse(result);
        await handler(data);
      } catch (error) {
        logger.error(`Worker error for queue ${queueName}:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // Schedule a job to run at a specific time
  static async schedule(
    jobName: string,
    cronExpression: string,
    handler: () => Promise<void>
  ): Promise<void> {
    // In production, use a proper scheduler like node-cron
    const cron = require('node-cron');
    cron.schedule(cronExpression, async () => {
      try {
        logger.info(`Running scheduled job: ${jobName}`);
        await handler();
        logger.info(`Completed scheduled job: ${jobName}`);
      } catch (error) {
        logger.error(`Scheduled job ${jobName} failed:`, error);
      }
    });
    logger.info(`Scheduled job ${jobName} with cron: ${cronExpression}`);
  }
}