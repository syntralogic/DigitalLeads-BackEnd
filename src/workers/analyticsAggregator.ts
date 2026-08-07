import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class AnalyticsAggregator {
  static async process(): Promise<void> {
    try {
      logger.info('Starting analytics aggregation...');

      // Aggregate daily stats
      await this.aggregateDailyStats();

      // Aggregate weekly stats
      await this.aggregateWeeklyStats();

      // Aggregate monthly stats
      await this.aggregateMonthlyStats();

      // Update Redis caches
      await this.updateCaches();

      logger.info('Analytics aggregation completed');
    } catch (error) {
      logger.error('Analytics aggregation error:', error);
    }
  }

  private static async aggregateDailyStats(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get stats for yesterday
    const [clicks, conversions, revenue] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: {
            gte: yesterday,
            lt: today,
          },
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: {
            gte: yesterday,
            lt: today,
          },
        },
      }),
      prisma.conversion.aggregate({
        where: {
          timestamp: {
            gte: yesterday,
            lt: today,
          },
          status: 'APPROVED',
        },
        _sum: {
          revenue: true,
        },
      }),
    ]);

    // Store in Redis
    const dateKey = yesterday.toISOString().split('T')[0];
    await redis.hset(`analytics:day:${dateKey}`, {
      clicks,
      conversions,
      revenue: revenue._sum.revenue || 0,
    });
    await redis.expire(`analytics:day:${dateKey}`, 30 * 24 * 60 * 60); // 30 days

    logger.info('Daily stats aggregated', { date: dateKey, clicks, conversions });
  }

  private static async aggregateWeeklyStats(): Promise<void> {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date();
    endOfWeek.setHours(0, 0, 0, 0);

    const [clicks, conversions, revenue] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
        },
      }),
      prisma.conversion.aggregate({
        where: {
          timestamp: {
            gte: startOfWeek,
            lt: endOfWeek,
          },
          status: 'APPROVED',
        },
        _sum: {
          revenue: true,
        },
      }),
    ]);

    const weekKey = `week-${startOfWeek.toISOString().split('T')[0]}`;
    await redis.hset(`analytics:week:${weekKey}`, {
      clicks,
      conversions,
      revenue: revenue._sum.revenue || 0,
    });
    await redis.expire(`analytics:week:${weekKey}`, 30 * 24 * 60 * 60);

    logger.info('Weekly stats aggregated', { weekKey, clicks, conversions });
  }

  private static async aggregateMonthlyStats(): Promise<void> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setHours(0, 0, 0, 0);

    const [clicks, conversions, revenue] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: {
            gte: startOfMonth,
            lt: endOfMonth,
          },
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: {
            gte: startOfMonth,
            lt: endOfMonth,
          },
        },
      }),
      prisma.conversion.aggregate({
        where: {
          timestamp: {
            gte: startOfMonth,
            lt: endOfMonth,
          },
          status: 'APPROVED',
        },
        _sum: {
          revenue: true,
        },
      }),
    ]);

    const monthKey = `month-${startOfMonth.toISOString().split('T')[0]}`;
    await redis.hset(`analytics:month:${monthKey}`, {
      clicks,
      conversions,
      revenue: revenue._sum.revenue || 0,
    });
    await redis.expire(`analytics:month:${monthKey}`, 30 * 24 * 60 * 60);

    logger.info('Monthly stats aggregated', { monthKey, clicks, conversions });
  }

  private static async updateCaches(): Promise<void> {
    // Update dashboard KPIs cache
    const kpis = await this.getKPIs();
    await redis.set('dashboard:kpis', JSON.stringify(kpis), 'EX', 60);

    // Update top offers cache
    const topOffers = await this.getTopOffers();
    await redis.set('dashboard:topOffers', JSON.stringify(topOffers), 'EX', 60);

    // Update top networks cache
    const topNetworks = await this.getTopNetworks();
    await redis.set('dashboard:topNetworks', JSON.stringify(topNetworks), 'EX', 60);

    logger.info('Caches updated successfully');
  }

  private static async getKPIs(): Promise<any> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [clicks, conversions, revenue, pending, approved, rejected] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: { gte: thirtyDaysAgo },
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: { gte: thirtyDaysAgo },
        },
      }),
      prisma.conversion.aggregate({
        where: {
          timestamp: { gte: thirtyDaysAgo },
          status: 'APPROVED',
        },
        _sum: { revenue: true },
      }),
      prisma.conversion.count({
        where: {
          timestamp: { gte: thirtyDaysAgo },
          status: 'PENDING',
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: { gte: thirtyDaysAgo },
          status: 'APPROVED',
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: { gte: thirtyDaysAgo },
          status: 'REJECTED',
        },
      }),
    ]);

    return {
      clicks: clicks || 0,
      conversions: conversions || 0,
      revenue: revenue._sum.revenue || 0,
      pending: pending || 0,
      approved: approved || 0,
      rejected: rejected || 0,
    };
  }

  private static async getTopOffers(): Promise<any> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return prisma.$queryRaw`
      SELECT 
        o.id,
        o.name,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.revenue), 0) as revenue
      FROM "offers" o
      LEFT JOIN "clicks" c ON c.offer_id = o.id
      LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
      WHERE c.timestamp >= ${thirtyDaysAgo}
      GROUP BY o.id, o.name
      ORDER BY conversions DESC
      LIMIT 10
    `;
  }

  private static async getTopNetworks(): Promise<any> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return prisma.$queryRaw`
      SELECT 
        n.id,
        n.name,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.revenue), 0) as revenue
      FROM "networks" n
      LEFT JOIN "clicks" c ON c.network_id = n.id
      LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
      WHERE c.timestamp >= ${thirtyDaysAgo}
      GROUP BY n.id, n.name
      ORDER BY conversions DESC
      LIMIT 10
    `;
  }
}