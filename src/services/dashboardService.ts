import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';

type DashboardRange = 'today' | '7d' | '30d' | '90d';

export class DashboardService {
  static async getKpis(range: DashboardRange = 'today') {
    const cacheKey = `dashboard:kpis:${range}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const dateRange = this.getDateRange(range);

    const [
      liveClicks,
      uniqueClicks,
      conversions,
      pending,
      approved,
      rejected,
      revenue,
      epc,
      conversionRate,
      redirectRate,
    ] = await Promise.all([
      prisma.click.count({
        where: {
          timestamp: dateRange,
        },
      }),
      prisma.click.groupBy({
        by: ['sessionId'],
        where: {
          timestamp: dateRange,
          sessionId: { not: null },
        },
      }).then(result => result.length),
      prisma.conversion.count({
        where: {
          timestamp: dateRange,
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: dateRange,
          status: 'PENDING',
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: dateRange,
          status: 'APPROVED',
        },
      }),
      prisma.conversion.count({
        where: {
          timestamp: dateRange,
          status: 'REJECTED',
        },
      }),
      prisma.conversion.aggregate({
        where: {
          timestamp: dateRange,
          status: 'APPROVED',
        },
        _sum: {
          revenue: true,
        },
      }).then(result => result._sum.revenue || 0),
      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN COUNT(*) = 0 THEN 0 
            ELSE SUM(c.revenue) / COUNT(*) 
          END as epc
        FROM "conversions" c
        WHERE c.timestamp >= ${dateRange.gte} 
          AND c.timestamp <= ${dateRange.lte}
          AND c.status = 'APPROVED'
      `,
      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN COUNT(DISTINCT cl.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT c.id)::float / COUNT(DISTINCT cl.id)) * 100
          END as conversion_rate
        FROM "clicks" cl
        LEFT JOIN "conversions" c ON c.click_id = cl.click_id
        WHERE cl.timestamp >= ${dateRange.gte} 
          AND cl.timestamp <= ${dateRange.lte}
      `,
      prisma.$queryRaw`
        SELECT 
          CASE 
            WHEN COUNT(*) = 0 THEN 0 
            ELSE (COUNT(*) FILTER (WHERE referrer IS NOT NULL)::float / COUNT(*)) * 100
          END as redirect_rate
        FROM "clicks"
        WHERE timestamp >= ${dateRange.gte} 
          AND timestamp <= ${dateRange.lte}
      `,
    ]);

    const kpis = {
      liveClicks: liveClicks || 0,
      uniqueClicks: uniqueClicks || 0,
      conversions: conversions || 0,
      pending: pending || 0,
      approved: approved || 0,
      rejected: rejected || 0,
      revenue: revenue || 0,
      epc: Number((epc as any)?.[0]?.epc || 0),
      conversionRate: Number((conversionRate as any)?.[0]?.conversion_rate || 0),
      redirectRate: Number((redirectRate as any)?.[0]?.redirect_rate || 0),
    };

    await cache.set(cacheKey, kpis, 30);
    return kpis;
  }

  static async getSeries(metric: string, range: DashboardRange = 'today') {
    const cacheKey = `dashboard:series:${metric}:${range}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const dateRange = this.getDateRange(range);
    const interval = this.getInterval(range);

    const series = await this.generateTimeSeries(metric, dateRange, interval);

    await cache.set(cacheKey, series, 60);
    return series;
  }

  static async getBreakdown(dimension: string, range: DashboardRange = 'today') {
    const cacheKey = `dashboard:breakdown:${dimension}:${range}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const dateRange = this.getDateRange(range);

    const dimensionMap: Record<string, string> = {
      offers: 'offerId',
      networks: 'networkId',
      sources: 'source',
      countries: 'country',
      devices: 'device',
      browsers: 'browser',
      os: 'os',
    };

    const field = dimensionMap[dimension];
    if (!field) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }

    const breakdown = await prisma.$queryRaw`
      SELECT 
        ${field} as id,
        ${field} as label,
        COUNT(*) as count,
        COALESCE(SUM(revenue), 0) as revenue
      FROM "conversions"
      WHERE timestamp >= ${dateRange.gte} 
        AND timestamp <= ${dateRange.lte}
        AND ${field} IS NOT NULL
      GROUP BY ${field}
      ORDER BY count DESC
      LIMIT 10
    `;

    await cache.set(cacheKey, breakdown, 60);
    return breakdown;
  }

  static async getLiveActivity() {
    const [recentConversions, recentClicks] = await Promise.all([
      prisma.conversion.findMany({
        take: 10,
        orderBy: { timestamp: 'desc' },
        include: {
          offer: {
            select: { name: true },
          },
          network: {
            select: { name: true },
          },
        },
      }),
      prisma.click.findMany({
        take: 10,
        orderBy: { timestamp: 'desc' },
        include: {
          offer: {
            select: { name: true },
          },
        },
      }),
    ]);

    const activities = [
      ...recentConversions.map(c => ({
        id: c.id,
        type: 'conversion' as const,
        label: `Conversion: ${c.offer?.name || 'Unknown Offer'}`,
        time: c.timestamp.toISOString(),
        details: `${c.country || 'Unknown'} - ${c.status}`,
      })),
      ...recentClicks.map(c => ({
        id: c.id,
        type: 'click' as const,
        label: `Click: ${c.offer?.name || 'Unknown Offer'}`,
        time: c.timestamp.toISOString(),
        details: `${c.country || 'Unknown'} - ${c.device || 'Unknown Device'}`,
      })),
    ]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 20);

    return activities;
  }

  static async getAIRecommendations() {
    const cacheKey = 'dashboard:ai-recommendations';
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const recommendations = [];

    const lowPerformingOffers = await prisma.$queryRaw`
      SELECT 
        o.id,
        o.name,
        COUNT(c.id) as conversions,
        COALESCE(SUM(c.revenue), 0) as revenue
      FROM "offers" o
      LEFT JOIN "conversions" c ON c.offer_id = o.id
      WHERE c.timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY o.id, o.name
      HAVING COUNT(c.id) < 5
      ORDER BY revenue ASC
      LIMIT 3
    `;

    if ((lowPerformingOffers as any[]).length > 0) {
      recommendations.push({
        id: 'low-performing-offers',
        title: 'Optimize Low-Performing Offers',
        detail: `${(lowPerformingOffers as any[]).length} offers have low conversion rates. Consider adjusting targeting or pausing them.`,
        impact: 'High',
      });
    }

    const fraudSignals = await prisma.fraudSignal.count({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
        resolved: false,
      },
    });

    if (fraudSignals > 0) {
      recommendations.push({
        id: 'fraud-detected',
        title: 'Fraud Signals Detected',
        detail: `${fraudSignals} fraud signals detected in the last 24 hours. Review and take action.`,
        impact: 'Critical',
      });
    }

    const unhealthyNetworks = await prisma.network.count({
      where: {
        apiHealthy: false,
        status: 'ACTIVE',
      },
    });

    if (unhealthyNetworks > 0) {
      recommendations.push({
        id: 'network-issues',
        title: 'Network Connection Issues',
        detail: `${unhealthyNetworks} networks are experiencing connection issues. Check API configurations.`,
        impact: 'High',
      });
    }

    await cache.set(cacheKey, recommendations, 300);
    return recommendations;
  }

  private static getDateRange(range: DashboardRange): { gte: Date; lte: Date } {
    const now = new Date();
    const gte = new Date(now);

    switch (range) {
      case 'today':
        gte.setHours(0, 0, 0, 0);
        break;
      case '7d':
        gte.setDate(now.getDate() - 7);
        break;
      case '30d':
        gte.setDate(now.getDate() - 30);
        break;
      case '90d':
        gte.setDate(now.getDate() - 90);
        break;
      default:
        gte.setDate(now.getDate() - 1);
    }

    return { gte, lte: now };
  }

  private static getInterval(range: DashboardRange): string {
    switch (range) {
      case 'today':
        return 'hour';
      case '7d':
        return 'day';
      case '30d':
        return 'day';
      case '90d':
        return 'week';
      default:
        return 'day';
    }
  }

  private static async generateTimeSeries(metric: string, dateRange: { gte: Date; lte: Date }, interval: string) {
    const series = [];
    const current = new Date(dateRange.gte);

    while (current <= dateRange.lte) {
      const next = new Date(current);
      if (interval === 'hour') {
        next.setHours(current.getHours() + 1);
      } else if (interval === 'day') {
        next.setDate(current.getDate() + 1);
      } else if (interval === 'week') {
        next.setDate(current.getDate() + 7);
      }

      const value = await this.getMetricValue(metric, current, next);

      series.push({
        timestamp: current.toISOString(),
        value,
      });

      current.setTime(next.getTime());
    }

    return series;
  }

  private static async getMetricValue(metric: string, start: Date, end: Date): Promise<number> {
    switch (metric) {
      case 'clicks':
        return prisma.click.count({
          where: {
            timestamp: {
              gte: start,
              lt: end,
            },
          },
        });
      case 'conversions':
        return prisma.conversion.count({
          where: {
            timestamp: {
              gte: start,
              lt: end,
            },
          },
        });
      case 'revenue':
        const revenue = await prisma.conversion.aggregate({
          where: {
            timestamp: {
              gte: start,
              lt: end,
            },
            status: 'APPROVED',
          },
          _sum: {
            revenue: true,
          },
        });
        return revenue._sum.revenue || 0;
      default:
        return 0;
    }
  }
}