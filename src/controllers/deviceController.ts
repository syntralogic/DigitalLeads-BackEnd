import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';

export class DeviceController {
  static async getDevices(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'devices:report';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      // Fixed: Use double quotes for case-sensitive column names
      const devices = await prisma.$queryRaw`
        SELECT 
          c.device,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= NOW() - INTERVAL '30 days'
          AND c.device IS NOT NULL
        GROUP BY c.device
        ORDER BY clicks DESC
      `;

      const result = (devices as any[]).map((row: any) => ({
        device: row.device || 'Unknown',
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
        conversionRate: Number(row.conversion_rate) || 0,
      }));

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      console.error('Devices error:', error);
      next(error);
    }
  }
}