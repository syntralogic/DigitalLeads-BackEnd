// src/services/dashboardService.ts
import { prisma } from '../config/database';
import { cache } from '../config/redis';

type DashboardRange = 'today' | '7d' | '30d' | '90d';

// Define the breakdown row type
type BreakdownRow = {
  id: string;
  label: string;
  count: number;
  revenue: number;
};

export class DashboardService {
  static async getKpis(range: DashboardRange = 'today') {
    const cacheKey = `dashboard:kpis:${range}`;
    
    const cached = await cache.get(cacheKey);

    if (cached) {
      console.log('📊 Using cached KPIs:', cached);
      return cached;
    }

    const dateRange = this.getDateRange(range);
    console.log('📅 Date range:', {
      range,
      gte: dateRange.gte.toISOString(),
      lte: dateRange.lte.toISOString()
    });

    try {
      // ✅ Use raw SQL for all queries to avoid ORM issues
      const [clicksResult, conversionsResult, uniqueResult, revenueResult, pendingResult, approvedResult, rejectedResult, referrerResult] = await Promise.all([
        // Total clicks in range
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "clicks"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
        `,
        // Total conversions in range
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "conversions"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
        `,
        // Unique clicks
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(DISTINCT "sessionId") as count FROM "clicks"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND "sessionId" IS NOT NULL
        `,
        // Revenue
        prisma.$queryRaw<{ revenue: number }[]>`
          SELECT COALESCE(SUM(revenue), 0) as revenue FROM "conversions"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND status = 'APPROVED'
        `,
        // Pending
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "conversions"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND status = 'PENDING'
        `,
        // Approved
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "conversions"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND status = 'APPROVED'
        `,
        // Rejected
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "conversions"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND status = 'REJECTED'
        `,
        // Redirect rate - clicks with referrer
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*) as count FROM "clicks"
          WHERE timestamp >= ${dateRange.gte} AND timestamp <= ${dateRange.lte}
          AND referrer IS NOT NULL
        `,
      ]);

      const liveClicks = Number(clicksResult[0]?.count || 0);
      const conversions = Number(conversionsResult[0]?.count || 0);
      const uniqueClicks = Number(uniqueResult[0]?.count || 0);
      const revenue = Number(revenueResult[0]?.revenue || 0);
      const pending = Number(pendingResult[0]?.count || 0);
      const approved = Number(approvedResult[0]?.count || 0);
      const rejected = Number(rejectedResult[0]?.count || 0);
      const clicksWithReferrer = Number(referrerResult[0]?.count || 0);

      console.log('📊 Raw results:', {
        liveClicks,
        conversions,
        uniqueClicks,
        revenue,
        pending,
        approved,
        rejected,
        clicksWithReferrer
      });

      // Calculate derived metrics
      const epc = liveClicks > 0 ? Number((revenue / liveClicks).toFixed(2)) : 0;
      const conversionRate = liveClicks > 0 ? Number(((conversions / liveClicks) * 100).toFixed(2)) : 0;
      const redirectRate = liveClicks > 0 ? Number(((clicksWithReferrer / liveClicks) * 100).toFixed(2)) : 0;

      const kpis = {
        liveClicks: liveClicks || 0,
        uniqueClicks: uniqueClicks || 0,
        conversions: conversions || 0,
        pending: pending || 0,
        approved: approved || 0,
        rejected: rejected || 0,
        revenue: Number(revenue.toFixed(2)) || 0,
        epc,
        conversionRate,
        redirectRate,
      };

      console.log('📊 Final KPIs:', kpis);

      await cache.set(cacheKey, kpis, 30);
      return kpis;
    } catch (error) {
      console.error('❌ Error calculating KPIs:', error);
      return {
        liveClicks: 0,
        uniqueClicks: 0,
        conversions: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        revenue: 0,
        epc: 0,
        conversionRate: 0,
        redirectRate: 0,
      };
    }
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

    // Map dimension to database column name
    const dimensionMap: Record<string, string> = {
      offers: 'offerId',
      networks: 'networkId',
      sources: 'referrer',
      countries: 'country',
      devices: 'device',
      browsers: 'browser',
      os: 'os',
    };

    const field = dimensionMap[dimension];
    if (!field) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }

    let breakdown: BreakdownRow[] = [];

    try {
      // For offers, join with offers table to get names
      if (dimension === 'offers') {
        const result = await prisma.$queryRaw<BreakdownRow[]>`
          SELECT 
            o.id as id,
            o.name as label,
            COUNT(c.id) as count,
            COALESCE(SUM(c.revenue), 0) as revenue
          FROM "conversions" c
          LEFT JOIN "offers" o ON o.id = c."offerId"
          WHERE c.timestamp >= ${dateRange.gte} 
            AND c.timestamp <= ${dateRange.lte}
            AND c."offerId" IS NOT NULL
          GROUP BY o.id, o.name
          ORDER BY count DESC
          LIMIT 10
        `;
        breakdown = result;
      } 
      // For networks, join with networks table to get names
      else if (dimension === 'networks') {
        const result = await prisma.$queryRaw<BreakdownRow[]>`
          SELECT 
            n.id as id,
            n.name as label,
            COUNT(c.id) as count,
            COALESCE(SUM(c.revenue), 0) as revenue
          FROM "conversions" c
          LEFT JOIN "networks" n ON n.id = c."networkId"
          WHERE c.timestamp >= ${dateRange.gte} 
            AND c.timestamp <= ${dateRange.lte}
            AND c."networkId" IS NOT NULL
          GROUP BY n.id, n.name
          ORDER BY count DESC
          LIMIT 10
        `;
        breakdown = result;
      } 
      // For other dimensions, use the field directly
      else {
        const query = `
          SELECT 
            "${field}" as id,
            "${field}" as label,
            COUNT(*) as count,
            COALESCE(SUM(revenue), 0) as revenue
          FROM "conversions"
          WHERE timestamp >= $1 
            AND timestamp <= $2
            AND "${field}" IS NOT NULL
          GROUP BY "${field}"
          ORDER BY count DESC
          LIMIT 10
        `;
        
        const result = await prisma.$queryRawUnsafe<BreakdownRow[]>(query, dateRange.gte, dateRange.lte);
        breakdown = result;
      }

      await cache.set(cacheKey, breakdown, 60);
      return breakdown;
    } catch (error) {
      console.error(`Breakdown error for ${dimension}:`, error);
      return [];
    }
  }

  static async getLiveActivity() {
    try {
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
    } catch (error) {
      console.error('Error fetching live activity:', error);
      return [];
    }
  }

  static async getAIRecommendations() {
    const cacheKey = 'dashboard:ai-recommendations';
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const recommendations = [];

    try {
      // Check for networks with issues
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

      // Check for fraud signals
      const fraudSignals = await prisma.fraudSignal.count({
        where: {
          resolved: false,
        },
      });

      if (fraudSignals > 0) {
        recommendations.push({
          id: 'fraud-detected',
          title: 'Fraud Signals Detected',
          detail: `${fraudSignals} fraud signals detected. Review and take action.`,
          impact: 'Critical',
        });
      }

      // Check for pending conversions
      const pendingConversions = await prisma.conversion.count({
        where: {
          status: 'PENDING',
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      if (pendingConversions > 10) {
        recommendations.push({
          id: 'pending-conversions',
          title: 'Pending Conversions',
          detail: `${pendingConversions} conversions are pending approval. Review them to ensure timely payouts.`,
          impact: 'Medium',
        });
      }

      await cache.set(cacheKey, recommendations, 300);
      return recommendations;
    } catch (error) {
      console.error('Error generating AI recommendations:', error);
      return [];
    }
  }

  private static getDateRange(range: DashboardRange): { gte: Date; lte: Date } {
    const now = new Date();
    const gte = new Date(now);

    switch (range) {
      case 'today':
        gte.setHours(0, 0, 0, 0);
        gte.setMinutes(0, 0, 0);
        gte.setSeconds(0, 0);
        break;
      case '7d':
        gte.setDate(now.getDate() - 7);
        gte.setHours(0, 0, 0, 0);
        gte.setMinutes(0, 0, 0);
        gte.setSeconds(0, 0);
        break;
      case '30d':
        gte.setDate(now.getDate() - 30);
        gte.setHours(0, 0, 0, 0);
        gte.setMinutes(0, 0, 0);
        gte.setSeconds(0, 0);
        break;
      case '90d':
        gte.setDate(now.getDate() - 90);
        gte.setHours(0, 0, 0, 0);
        gte.setMinutes(0, 0, 0);
        gte.setSeconds(0, 0);
        break;
      default:
        gte.setDate(now.getDate() - 1);
        gte.setHours(0, 0, 0, 0);
        gte.setMinutes(0, 0, 0);
        gte.setSeconds(0, 0);
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