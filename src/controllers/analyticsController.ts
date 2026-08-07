import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

export class AnalyticsController {
  private static getDimensionField(dimension: string): string | null {
    const mapping: Record<string, string> = {
      offer: 'offer_id',
      network: 'network_id',
      country: 'country',
      device: 'device',
      browser: 'browser',
      os: 'os',
      source: 'source',
    };
    return mapping[dimension] || null;
  }

  static async getReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        dimension,
        granularity,
        from,
        to,
        search,
      } = req.query;

      if (!dimension) {
        throw new AppError('Dimension is required', 400);
      }

      const dateRange = {
        gte: from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lte: to ? new Date(to as string) : new Date(),
      };

      const cacheKey = `analytics:report:${dimension}:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const dimensionField = this.getDimensionField(dimension as string);

      if (!dimensionField) {
        throw new AppError('Invalid dimension', 400);
      }

      // Build SQL query - Fixed column names
      let sql = `
        SELECT 
          ${dimensionField} as id,
          ${dimensionField} as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          COALESCE(SUM(conv.payout), 0) as payout,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE COALESCE(SUM(conv.revenue), 0) / COUNT(DISTINCT c.id) 
          END as epc
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= $1 
          AND c.timestamp <= $2
      `;

      const params: any[] = [dateRange.gte, dateRange.lte];
      let paramIndex = 3;

      if (search) {
        sql += ` AND ${dimensionField} ILIKE $${paramIndex}`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      sql += ` GROUP BY ${dimensionField} ORDER BY clicks DESC LIMIT 50`;

      const report = await prisma.$queryRawUnsafe(sql, ...params);

      // Convert BigInt values to Number for JSON serialization
      const serializedData = (report as any[]).map(item => ({
        ...item,
        clicks: Number(item.clicks) || 0,
        conversions: Number(item.conversions) || 0,
        revenue: Number(item.revenue) || 0,
        payout: Number(item.payout) || 0,
        conversion_rate: Number(item.conversion_rate) || 0,
        epc: Number(item.epc) || 0,
      }));

      const result = {
        dimension,
        granularity,
        dateRange,
        data: serializedData || [],
      };

      await cache.set(cacheKey, result, 60);
      res.json(result);
      return;
    } catch (error) {
      console.error('Analytics Report error:', error);
      next(error);
    }
  }

  static async getSeries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        dimension,
        granularity,
        from,
        to,
      } = req.query;

      if (!dimension) {
        throw new AppError('Dimension is required', 400);
      }

      const dateRange = {
        gte: from ? new Date(from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lte: to ? new Date(to as string) : new Date(),
      };

      const cacheKey = `analytics:series:${dimension}:${JSON.stringify(req.query)}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      // Determine interval based on granularity
      let interval: string;
      switch (granularity) {
        case 'hourly':
          interval = "DATE_TRUNC('hour', timestamp)";
          break;
        case 'daily':
          interval = "DATE_TRUNC('day', timestamp)";
          break;
        case 'weekly':
          interval = "DATE_TRUNC('week', timestamp)";
          break;
        case 'monthly':
          interval = "DATE_TRUNC('month', timestamp)";
          break;
        default:
          interval = "DATE_TRUNC('day', timestamp)";
      }

      const series = await prisma.$queryRaw`
        SELECT 
          ${interval} as time_bucket,
          COUNT(*) as clicks,
          COUNT(DISTINCT "clickId") as unique_clicks,
          COALESCE(SUM(revenue), 0) as revenue
        FROM "conversions"
        WHERE timestamp >= ${dateRange.gte} 
          AND timestamp <= ${dateRange.lte}
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

      const result = (series as any[]).map((item: any) => ({
        timestamp: item.time_bucket instanceof Date ? item.time_bucket.toISOString() : String(item.time_bucket),
        clicks: Number(item.clicks) || 0,
        uniqueClicks: Number(item.unique_clicks) || 0,
        revenue: Number(item.revenue) || 0,
      }));

      await cache.set(cacheKey, result, 60);
      res.json(result);
      return;
    } catch (error) {
      console.error('Analytics Series error:', error);
      next(error);
    }
  }

  static async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        dimension,
        from,
        to,
        format = 'csv',
      } = req.body;

      if (!dimension) {
        throw new AppError('Dimension is required', 400);
      }

      const dateRange = {
        gte: from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lte: to ? new Date(to) : new Date(),
      };

      const dimensionField = this.getDimensionField(dimension);

      if (!dimensionField) {
        throw new AppError('Invalid dimension', 400);
      }

      let sql = `
        SELECT 
          ${dimensionField} as id,
          ${dimensionField} as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          COALESCE(SUM(conv.payout), 0) as payout
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.timestamp >= $1 
          AND c.timestamp <= $2
        GROUP BY ${dimensionField}
        ORDER BY clicks DESC
      `;

      const params = [dateRange.gte, dateRange.lte];

      const data = await prisma.$queryRawUnsafe(sql, ...params);

      // Convert BigInt values to Number
      const serializedData = (data as any[]).map(item => ({
        ...item,
        clicks: Number(item.clicks) || 0,
        conversions: Number(item.conversions) || 0,
        revenue: Number(item.revenue) || 0,
        payout: Number(item.payout) || 0,
      }));

      // Generate CSV
      if (format === 'csv') {
        const headers = ['ID', 'Label', 'Clicks', 'Conversions', 'Revenue', 'Payout'];
        const rows = serializedData.map(item => [
          item.id || '',
          item.label || '',
          Number(item.clicks) || 0,
          Number(item.conversions) || 0,
          Number(item.revenue) || 0,
          Number(item.payout) || 0,
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=analytics_${Date.now()}.csv`);
        res.send(csvContent);
        return;
      }

      res.json({
        data: serializedData,
        exportedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      console.error('Analytics Export error:', error);
      next(error);
    }
  }

  static async getGeo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { level } = req.params;

      const cacheKey = `analytics:geo:${level}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      let groupBy: string;
      switch (level) {
        case 'country':
          groupBy = 'country';
          break;
        case 'state':
          groupBy = 'region';
          break;
        case 'city':
          groupBy = 'city';
          break;
        case 'isp':
          groupBy = 'isp';
          break;
        case 'language':
          groupBy = 'language';
          break;
        case 'timezone':
          groupBy = 'timezone';
          break;
        default:
          throw new AppError('Invalid geo level', 400);
      }

      const geoData = await prisma.$queryRaw`
        SELECT 
          ${groupBy} as id,
          ${groupBy} as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE ${groupBy} IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY ${groupBy}
        ORDER BY clicks DESC
        LIMIT 100
      `;

      // Convert BigInt values to Number for JSON serialization
      const serializedData = (geoData as any[]).map(item => ({
        ...item,
        clicks: Number(item.clicks) || 0,
        conversions: Number(item.conversions) || 0,
        revenue: Number(item.revenue) || 0,
      }));

      await cache.set(cacheKey, serializedData, 300);
      res.json(serializedData);
      return;
    } catch (error) {
      console.error('Analytics Geo error:', error);
      next(error);
    }
  }

  static async getDevices(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'analytics:devices';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      const devices = await prisma.$queryRaw`
        SELECT 
          c.device as id,
          c.device as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.device IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.device
        ORDER BY clicks DESC
      `;

      // Convert BigInt values to Number for JSON serialization
      const serializedData = (devices as any[]).map(item => ({
        ...item,
        clicks: Number(item.clicks) || 0,
        conversions: Number(item.conversions) || 0,
        revenue: Number(item.revenue) || 0,
        conversion_rate: Number(item.conversion_rate) || 0,
      }));

      await cache.set(cacheKey, serializedData, 300);
      res.json(serializedData);
      return;
    } catch (error) {
      console.error('Analytics Devices error:', error);
      next(error);
    }
  }
}