import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class FraudCleanup {
  static async run(): Promise<void> {
    try {
      logger.info('Running fraud cleanup...');

      // Cleanup old fraud signals
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deleted = await prisma.fraudSignal.deleteMany({
        where: {
          timestamp: {
            lt: thirtyDaysAgo,
          },
          resolved: true,
        },
      });

      logger.info(`Cleaned up ${deleted.count} old fraud signals`);

      // Cleanup resolved signals
      const resolved = await prisma.fraudSignal.updateMany({
        where: {
          timestamp: {
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
          resolved: false,
        },
        data: {
          resolved: true,
        },
      });

      logger.info(`Auto-resolved ${resolved.count} old fraud signals`);

      // Cleanup expired blacklisted IPs (30 days)
      const blacklistExpiry = 30 * 24 * 60 * 60; // 30 days in seconds
      const blacklistedIPs = await redis.smembers('blacklist:ips');

      for (const ip of blacklistedIPs) {
        const lastSeen = await redis.get(`blacklist:lastseen:${ip}`);
        if (lastSeen) {
          const age = (Date.now() - parseInt(lastSeen)) / 1000;
          if (age > blacklistExpiry) {
            await redis.srem('blacklist:ips', ip);
            await redis.del(`blacklist:lastseen:${ip}`);
            logger.info(`Removed expired blacklisted IP: ${ip}`);
          }
        }
      }

      logger.info('Fraud cleanup completed');
    } catch (error) {
      logger.error('Fraud cleanup error:', error);
    }
  }
}