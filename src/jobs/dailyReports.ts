import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { NotificationService } from '../services/notificationService';

export class DailyReports {
  static async run(): Promise<void> {
    try {
      logger.info('Running daily reports...');

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get daily stats
      const [clicks, conversions, revenue, topOffers, topNetworks] = await Promise.all([
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
        prisma.$queryRaw`
          SELECT 
            o.name,
            COUNT(DISTINCT c.id) as clicks,
            COUNT(DISTINCT conv.id) as conversions
          FROM "offers" o
          LEFT JOIN "clicks" c ON c.offer_id = o.id
          LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
          WHERE c.timestamp >= ${yesterday} AND c.timestamp < ${today}
          GROUP BY o.id, o.name
          ORDER BY conversions DESC
          LIMIT 5
        `,
        prisma.$queryRaw`
          SELECT 
            n.name,
            COUNT(DISTINCT c.id) as clicks,
            COUNT(DISTINCT conv.id) as conversions
          FROM "networks" n
          LEFT JOIN "clicks" c ON c.network_id = n.id
          LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
          WHERE c.timestamp >= ${yesterday} AND c.timestamp < ${today}
          GROUP BY n.id, n.name
          ORDER BY conversions DESC
          LIMIT 5
        `,
      ]);

      // Store daily report
      const report = {
        date: yesterday.toISOString().split('T')[0],
        clicks,
        conversions,
        revenue: revenue._sum.revenue || 0,
        topOffers: topOffers || [],
        topNetworks: topNetworks || [],
      };

      await redis.set(`report:daily:${report.date}`, JSON.stringify(report), 'EX', 30 * 24 * 60 * 60);

      // Send notifications to admins
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
          'Daily Report Available',
          `Daily report for ${report.date} is ready. Clicks: ${clicks}, Conversions: ${conversions}, Revenue: $${report.revenue.toFixed(2)}`,
          { report }
        );
      }

      logger.info('Daily reports completed', report);
    } catch (error) {
      logger.error('Daily reports error:', error);
    }
  }
}