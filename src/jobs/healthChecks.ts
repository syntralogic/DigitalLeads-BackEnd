import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { NotificationService } from '../services/notificationService';

export class HealthChecks {
  static async run(): Promise<void> {
    try {
      logger.info('Running health checks...');

      // Check database connection
      try {
        await prisma.$queryRaw`SELECT 1`;
        await redis.set('health:db', 'ok', 'EX', 60);
      } catch (error) {
        logger.error('Database health check failed:', error);
        await this.triggerAlert('Database', 'Database connection failed');
      }

      // Check Redis connection
      try {
        await redis.ping();
        await redis.set('health:redis', 'ok', 'EX', 60);
      } catch (error) {
        logger.error('Redis health check failed:', error);
        await this.triggerAlert('Redis', 'Redis connection failed');
      }

      // Check network connections
      const unhealthyNetworks = await prisma.network.findMany({
        where: {
          apiHealthy: false,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          name: true,
          apiUrl: true,
        },
      });

      if (unhealthyNetworks.length > 0) {
        const networkNames = unhealthyNetworks.map(n => n.name).join(', ');
        await this.triggerAlert(
          'Networks',
          `Unhealthy networks detected: ${networkNames}`
        );
      }

      // Check queue health
      const queueLengths = await Promise.all([
        redis.llen('email:queue'),
        redis.llen('telegram:queue'),
        redis.llen('postback:queue'),
        redis.llen('analytics:queue'),
      ]);

      const totalQueued = queueLengths.reduce((a, b) => a + b, 0);
      if (totalQueued > 1000) {
        await this.triggerAlert(
          'Queue',
          `High queue backlog: ${totalQueued} items queued`
        );
      }

      // Check fraud rate
      const fraudRate = await this.getFraudRate();
      if (fraudRate > 0.1) { // > 10% fraud rate
        await this.triggerAlert(
          'Fraud',
          `High fraud rate detected: ${(fraudRate * 100).toFixed(1)}%`
        );
      }

      logger.info('Health checks completed');
    } catch (error) {
      logger.error('Health checks error:', error);
    }
  }

  private static async triggerAlert(type: string, message: string): Promise<void> {
    logger.warn(`Health alert: ${type} - ${message}`);

    // Send notification to admins
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
      },
      select: {
        id: true,
      },
    });

    for (const admin of admins) {
      await NotificationService.createNotification(
        admin.id,
        'SYSTEM',
        `Health Alert: ${type}`,
        message,
        { type, severity: 'warning' }
      );
    }
  }

  private static async getFraudRate(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalClicks, fraudulentClicks] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: {
            gte: thirtyDaysAgo,
          },
        },
      }),
      prisma.click.count({
        where: {
          timestamp: {
            gte: thirtyDaysAgo,
          },
          isFraudulent: true,
        },
      }),
    ]);

    if (totalClicks === 0) return 0;
    return fraudulentClicks / totalClicks;
  }
}