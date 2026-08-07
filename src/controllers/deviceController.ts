import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';

// Define the device group type
interface DeviceGroup {
  clicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}

interface DeviceGroups {
  [key: string]: DeviceGroup;
}

export class DeviceController {
  static async getDevices(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'devices:report';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const devices = await prisma.$queryRaw`
        SELECT 
          device,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
        WHERE c.timestamp >= NOW() - INTERVAL '30 days'
          AND c.device IS NOT NULL
        GROUP BY device
        ORDER BY clicks DESC
      `;

      // Group by device type with proper typing
      const grouped: DeviceGroups = {
        Android: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        iPhone: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        Windows: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        macOS: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        Linux: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        Tablet: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
        Other: { clicks: 0, conversions: 0, revenue: 0, conversionRate: 0 },
      };

      for (const row of devices as any[]) {
        const device = row.device || 'Other';
        let key = 'Other';
        if (device.includes('Android')) key = 'Android';
        else if (device.includes('iPhone') || device.includes('iPad')) key = 'iPhone';
        else if (device.includes('Windows')) key = 'Windows';
        else if (device.includes('Mac')) key = 'macOS';
        else if (device.includes('Linux')) key = 'Linux';
        else if (device.includes('Tablet')) key = 'Tablet';

        if (grouped[key]) {
          grouped[key].clicks += Number(row.clicks) || 0;
          grouped[key].conversions += Number(row.conversions) || 0;
          grouped[key].revenue += Number(row.revenue) || 0;
        }
      }

      // Calculate conversion rates
      const result = Object.entries(grouped).map(([device, data]) => ({
        device,
        clicks: data.clicks,
        conversions: data.conversions,
        revenue: data.revenue,
        conversionRate: data.clicks > 0 ? (data.conversions / data.clicks) * 100 : 0,
      }));

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }
}