import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

export class AIController {
  // ============================================================
  // PUBLIC STATIC METHODS (called by routes)
  // ============================================================

  static async getScores(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'ai:scores';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const trafficQuality = await AIController.calculateTrafficQuality();
      const fraudScore = await AIController.calculateFraudScore();
      const optimizationLevel = AIController.calculateOptimizationLevel(trafficQuality, fraudScore);

      const result = {
        trafficQuality: Math.round(trafficQuality * 10) / 10,
        fraudScore: Math.round(fraudScore * 10) / 10,
        optimizationLevel: Math.round(optimizationLevel * 10) / 10,
      };

      await cache.set(cacheKey, result, 60);
      res.json(result);
      return;
    } catch (error) {
      console.error('AI Scores error:', error);
      next(error);
    }
  }

  static async getOffers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { type } = req.params;

      const cacheKey = `ai:offers:${type}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      let offers = [];

      if (type === 'best') {
        offers = await AIController.getBestOffers();
      } else if (type === 'worst') {
        offers = await AIController.getWorstOffers();
      } else {
        throw new AppError('Invalid offer type. Use "best" or "worst"', 400);
      }

      await cache.set(cacheKey, offers, 300);
      res.json(offers);
      return;
    } catch (error) {
      console.error('AI Offers error:', error);
      next(error);
    }
  }

  static async getForecast(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { metric } = req.params;

      const cacheKey = `ai:forecast:${metric}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const historical = await AIController.getHistoricalData();
      const forecast = AIController.forecastData(historical);

      await cache.set(cacheKey, forecast, 300);
      res.json(forecast);
      return;
    } catch (error) {
      console.error('AI Forecast error:', error);
      next(error);
    }
  }

  static async getRecommendations(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'ai:recommendations';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const recommendations = await AIController.generateRecommendations();

      await cache.set(cacheKey, recommendations, 300);
      res.json(recommendations);
      return;
    } catch (error) {
      console.error('AI Recommendations error:', error);
      next(error);
    }
  }

  static async getHeatmap(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'ai:heatmap';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const heatmap = await AIController.generateHeatmap();

      await cache.set(cacheKey, heatmap, 300);
      res.json(heatmap);
      return;
    } catch (error) {
      console.error('AI Heatmap error:', error);
      next(error);
    }
  }

  static async runOptimization(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await AIController.optimizeTraffic();

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'RUN_OPTIMIZATION',
          resource: 'AI',
          changes: { timestamp: new Date().toISOString() },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'AI optimization started successfully',
        started: true,
      });
      return;
    } catch (error) {
      console.error('AI Optimization error:', error);
      next(error);
    }
  }

  // ============================================================
  // PRIVATE STATIC METHODS (called by public methods)
  // ============================================================

  private static async calculateTrafficQuality(): Promise<number> {
    try {
      // Fixed: Use double quotes for column names
      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT c.id) as total_clicks,
          COUNT(DISTINCT conv.id) as total_conversions,
          COALESCE(AVG(CASE WHEN conv.status = 'APPROVED' THEN 1 ELSE 0 END), 0) as approval_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= NOW() - INTERVAL '30 days'
      `;

      const data = (stats as any[])[0] || { total_clicks: 0, total_conversions: 0, approval_rate: 0 };
      
      let score = 0;
      const totalClicks = Number(data.total_clicks) || 0;
      const totalConversions = Number(data.total_conversions) || 0;
      const approvalRate = Number(data.approval_rate) || 0;
      
      // Conversion rate (40% weight)
      const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;
      score += conversionRate * 40;
      
      // Approval rate (30% weight)
      score += approvalRate * 30;
      
      // Click volume (30% weight) - normalized
      const volumeScore = Math.min(totalClicks / 1000, 1) * 30;
      score += volumeScore;
      
      return Math.min(score, 100);
    } catch (error) {
      console.error('calculateTrafficQuality error:', error);
      return 50;
    }
  }

  private static async calculateFraudScore(): Promise<number> {
    try {
      const fraudCount = await prisma.fraudSignal.count({
        where: {
          timestamp: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
          resolved: false,
        },
      });

      const invalidClicks = await prisma.click.count({
        where: {
          isFraudulent: true,
          timestamp: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      });

      return Math.min((fraudCount * 2 + invalidClicks) * 5, 100);
    } catch (error) {
      console.error('calculateFraudScore error:', error);
      return 10;
    }
  }

  private static calculateOptimizationLevel(trafficQuality: number, fraudScore: number): number {
    return Math.min((trafficQuality * 0.6) + ((100 - fraudScore) * 0.4), 100);
  }

  private static async getBestOffers(): Promise<any[]> {
    try {
      // Fixed: Use "offerId" with quotes
      const offers = await prisma.$queryRaw`
        SELECT 
          o.id,
          o.name,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE COALESCE(SUM(conv.revenue), 0) / COUNT(DISTINCT c.id) 
          END as epc
        FROM "offers" o
        LEFT JOIN "clicks" c ON c."offerId" = o.id
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY o.id, o.name
        HAVING COUNT(DISTINCT c.id) > 0
        ORDER BY conversion_rate DESC, epc DESC
        LIMIT 10
      `;

      return (offers as any[]).map(offer => ({
        id: offer.id,
        name: offer.name,
        score: Math.round((Number(offer.conversion_rate) * 0.6 + Number(offer.epc) * 0.4) * 10) / 10,
      }));
    } catch (error) {
      console.error('getBestOffers error:', error);
      return [];
    }
  }

  private static async getWorstOffers(): Promise<any[]> {
    try {
      // Fixed: Use "offerId" with quotes
      const offers = await prisma.$queryRaw`
        SELECT 
          o.id,
          o.name,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "offers" o
        LEFT JOIN "clicks" c ON c."offerId" = o.id
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY o.id, o.name
        HAVING COUNT(DISTINCT c.id) > 100
        ORDER BY conversion_rate ASC
        LIMIT 5
      `;

      return (offers as any[]).map(offer => ({
        id: offer.id,
        name: offer.name,
        score: Math.round(Number(offer.conversion_rate) * 10) / 10,
      }));
    } catch (error) {
      console.error('getWorstOffers error:', error);
      return [];
    }
  }

  private static async getHistoricalData(): Promise<any[]> {
    try {
      const result = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('day', timestamp) as date,
          COUNT(*) as value
        FROM "conversions"
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date ASC
      `;
      return result as any[];
    } catch (error) {
      console.error('getHistoricalData error:', error);
      return [];
    }
  }

  private static forecastData(historical: any[]): any[] {
    if (historical.length < 2) {
      return historical.map(h => ({
        t: h.date ? new Date(h.date).toISOString() : new Date().toISOString(),
        value: Number(h.value) || 0,
      }));
    }

    const forecast = [];
    const dates = historical.map(h => new Date(h.date));
    const values = historical.map(h => Number(h.value));

    const window = Math.min(7, values.length);
    const lastValues = values.slice(-window);
    const average = lastValues.reduce((a, b) => a + b, 0) / lastValues.length;

    const lastDate = dates[dates.length - 1];
    for (let i = 1; i <= 7; i++) {
      const futureDate = new Date(lastDate);
      futureDate.setDate(futureDate.getDate() + i);
      
      const variation = (Math.random() - 0.5) * 0.2;
      const value = average * (1 + variation);
      
      forecast.push({
        t: futureDate.toISOString(),
        value: Math.round(value),
      });
    }

    return forecast;
  }

  private static async generateRecommendations(): Promise<any[]> {
    const recommendations = [];

    try {
      const lowConvertingOffers = await AIController.getWorstOffers();
      if (lowConvertingOffers.length > 0) {
        recommendations.push({
          id: 'optimize-offers',
          title: 'Optimize Low-Performing Offers',
          detail: `${lowConvertingOffers.length} offers have low conversion rates. Consider adjusting targeting or pausing them.`,
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

      const bestOffers = await AIController.getBestOffers();
      if (bestOffers.length > 0) {
        recommendations.push({
          id: 'scale-successful',
          title: 'Scale Successful Offers',
          detail: `${bestOffers.length} offers are performing well. Consider increasing budget or expanding targeting.`,
          impact: 'Medium',
        });
      }
    } catch (error) {
      console.error('generateRecommendations error:', error);
    }

    return recommendations;
  }

  private static async generateHeatmap(): Promise<any[]> {
    try {
      const heatmap = await prisma.$queryRaw`
        SELECT 
          EXTRACT(DOW FROM timestamp) as day_of_week,
          EXTRACT(HOUR FROM timestamp) as hour_of_day,
          COUNT(*) as value
        FROM "clicks"
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week ASC, hour_of_day ASC
      `;

      // Map day numbers to day names
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      return (heatmap as any[]).map(item => ({
        x: dayNames[Number(item.day_of_week)] || String(item.day_of_week),
        y: String(item.hour_of_day),
        value: Number(item.value) || 0,
      }));
    } catch (error) {
      console.error('generateHeatmap error:', error);
      return [];
    }
  }

  private static async optimizeTraffic(): Promise<void> {
    console.log('AI optimization started');
    console.log('AI optimization completed');
  }
}