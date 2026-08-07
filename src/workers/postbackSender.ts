import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import axios from 'axios';

export class PostbackSender {
  static async process(): Promise<void> {
    try {
      // Get pending postbacks from queue
      const pendingPostbacks = await redis.lrange('postback:queue', 0, -1);

      if (pendingPostbacks.length === 0) {
        return;
      }

      for (const postbackData of pendingPostbacks) {
        try {
          const data = JSON.parse(postbackData);
          await this.sendPostback(data);
          await redis.lrem('postback:queue', 1, postbackData);
        } catch (error) {
          logger.error('Postback sending error:', error);
          // Move to failed queue
          await redis.rpush('postback:failed', postbackData);
          await redis.lrem('postback:queue', 1, postbackData);
        }
      }

      logger.info(`Processed ${pendingPostbacks.length} postbacks`);
    } catch (error) {
      logger.error('Postback sender error:', error);
    }
  }

  static async sendPostback(data: any): Promise<void> {
    const { conversionId, url, method, payload } = data;

    try {
      const response = await axios({
        method: method.toLowerCase(),
        url,
        data: payload,
        timeout: 10000,
        validateStatus: () => true,
      });

      // Log successful postback
      await prisma.postbackLog.create({
        data: {
          scope: 'CONVERSION',
          scopeId: conversionId,
          url,
          method,
          payload,
          response: JSON.stringify(response.data),
          statusCode: response.status,
          success: response.status >= 200 && response.status < 300,
        },
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info('Postback sent successfully', { conversionId, url });
      } else {
        logger.warn('Postback failed', { conversionId, url, status: response.status });
      }
    } catch (error) {
      logger.error('Postback error:', error);

      // Log failed postback
      await prisma.postbackLog.create({
        data: {
          scope: 'CONVERSION',
          scopeId: conversionId,
          url,
          method,
          payload,
          success: false,
          error: error.message,
        },
      });

      // Increment retry count
      await redis.hincrby(`postback:retries:${conversionId}`, 'count', 1);
      const retries = await redis.hget(`postback:retries:${conversionId}`, 'count');

      if (Number(retries) < 3) {
        // Retry after delay
        const delay = Math.pow(2, Number(retries)) * 1000; // Exponential backoff
        setTimeout(() => {
          redis.rpush('postback:queue', JSON.stringify(data));
        }, delay);
      }

      throw error;
    }
  }

  static async retryFailed(): Promise<void> {
    try {
      const failedPostbacks = await redis.lrange('postback:failed', 0, -1);

      if (failedPostbacks.length === 0) {
        return;
      }

      for (const postbackData of failedPostbacks) {
        try {
          const data = JSON.parse(postbackData);
          await this.sendPostback(data);
          await redis.lrem('postback:failed', 1, postbackData);
        } catch (error) {
          logger.error('Retry failed postback error:', error);
        }
      }

      logger.info(`Retried ${failedPostbacks.length} failed postbacks`);
    } catch (error) {
      logger.error('Retry failed postbacks error:', error);
    }
  }
}