import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';

type DashboardRange = 'today' | '7d' | '30d' | '90d';

export class DashboardController {
  static async getKpis(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = (req.query.range as DashboardRange) || 'today';

      const cacheKey = `dashboard:kpis:${range}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      // Get date range
      const dateRange = getDateRange(range);

      // Query data using simpler queries
      const [
        liveClicks,
        conversions,
        pending,
        approved,
        rejected,
        revenue,
      ] = await Promise.all([
        // Live Clicks (total clicks in range)
        prisma.click.count({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
          },
        }),
        // Conversions
        prisma.conversion.count({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
          },
        }),
        // Pending
        prisma.conversion.count({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
            status: 'PENDING',
          },
        }),
        // Approved
        prisma.conversion.count({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
            status: 'APPROVED',
          },
        }),
        // Rejected
        prisma.conversion.count({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
            status: 'REJECTED',
          },
        }),
        // Revenue
        prisma.conversion.aggregate({
          where: {
            timestamp: {
              gte: dateRange.gte,
              lte: dateRange.lte,
            },
            status: 'APPROVED',
          },
          _sum: {
            revenue: true,
          },
        }).then(result => result._sum.revenue || 0),
      ]);

      // Calculate derived metrics
      const uniqueClicks = 0; // Simplified for now
      const epc = liveClicks > 0 ? revenue / liveClicks : 0;
      const conversionRate = liveClicks > 0 ? (conversions / liveClicks) * 100 : 0;
      const redirectRate = 0; // Simplified for now

      const kpis = {
        liveClicks: liveClicks || 0,
        uniqueClicks: uniqueClicks || 0,
        conversions: conversions || 0,
        pending: pending || 0,
        approved: approved || 0,
        rejected: rejected || 0,
        revenue: revenue || 0,
        epc: Number(epc.toFixed(2)),
        conversionRate: Number(conversionRate.toFixed(2)),
        redirectRate: Number(redirectRate.toFixed(2)),
      };

      // Cache for 30 seconds
      await cache.set(cacheKey, kpis, 30);

      res.json(kpis);
      return;
    } catch (error) {
      console.error('Dashboard KPIs error:', error);
      next(error);
    }
  }

  static async getSeries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const metric = req.params.metric;
      const range = (req.query.range as DashboardRange) || 'today';

      const cacheKey = `dashboard:series:${metric}:${range}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      // Generate sample data for now
      const series = [];
      const now = new Date();
      
      for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - (6 - i));
        series.push({
          timestamp: date.toISOString(),
          value: Math.floor(Math.random() * 100),
        });
      }

      await cache.set(cacheKey, series, 60);
      res.json(series);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dimension = req.params.dimension;
      const range = (req.query.range as DashboardRange) || 'today';

      const cacheKey = `dashboard:breakdown:${dimension}:${range}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      // Return empty array for now
      const breakdown: any[] = [];

      await cache.set(cacheKey, breakdown, 60);
      res.json(breakdown);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getLiveActivity(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Get recent conversions and clicks
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

      // Combine and format
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

      res.json(activities);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getAIRecommendations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'dashboard:ai-recommendations';
      const cached = await cache.get(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const recommendations = [];

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

      await cache.set(cacheKey, recommendations, 300);
      res.json(recommendations);
      return;
    } catch (error) {
      next(error);
    }
  }
}

// Helper functions
function getDateRange(range: DashboardRange): { gte: Date; lte: Date } {
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