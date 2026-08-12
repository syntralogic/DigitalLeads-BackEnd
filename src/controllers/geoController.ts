import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';

export class GeoController {
  static async getCountries(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = 'geo:countries';
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      // Fixed: Use double quotes for case-sensitive column names
      const countries = await prisma.$queryRaw`
        SELECT 
          c.country as id,
          c.country as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.country IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.country
        ORDER BY clicks DESC
      `;

      // Calculate percentages
      const total = (countries as any[]).reduce((sum, row) => sum + Number(row.clicks), 0);
      const result = (countries as any[]).map(row => ({
        ...row,
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
        conversion_rate: Number(row.conversion_rate) || 0,
        percentage: total > 0 ? (Number(row.clicks) / total) * 100 : 0,
      }));

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
      console.error('Geo Countries error:', error);
      next(error);
    }
  }

  static async getStates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { country } = req.query;

      let sql = `
        SELECT 
          c.city as id,
          c.city as label,
          c.country,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.city IS NOT NULL
      `;

      const params: any[] = [];
      if (country) {
        sql += ` AND c.country = $1`;
        params.push(country);
      }

      sql += ` AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.city, c.country
        ORDER BY clicks DESC
        LIMIT 100`;

      const states = await prisma.$queryRawUnsafe(sql, ...params);
      
      // Convert BigInt to Number
      const result = (states as any[]).map(row => ({
        ...row,
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
      }));

      res.json(result);
      return;
    } catch (error) {
      console.error('Geo States error:', error);
      next(error);
    }
  }

  static async getCities(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { country, state } = req.query;

      let sql = `
        SELECT 
          c.city as id,
          c.city as label,
          c.country,
          c.region,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.city IS NOT NULL
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (country) {
        sql += ` AND c.country = $${paramIndex}`;
        params.push(country);
        paramIndex++;
      }
      if (state) {
        sql += ` AND c.city = $${paramIndex}`;
        params.push(state);
        paramIndex++;
      }

      sql += ` AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.city, c.country, c.region
        ORDER BY clicks DESC
        LIMIT 100`;

      const cities = await prisma.$queryRawUnsafe(sql, ...params);
      
      const result = (cities as any[]).map(row => ({
        ...row,
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
      }));

      res.json(result);
      return;
    } catch (error) {
      console.error('Geo Cities error:', error);
      next(error);
    }
  }

  static async getISP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { country } = req.query;

      let sql = `
        SELECT 
          c.isp as id,
          c.isp as label,
          c.country,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.isp IS NOT NULL
      `;

      const params: any[] = [];
      if (country) {
        sql += ` AND c.country = $1`;
        params.push(country);
      }

      sql += ` AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.isp, c.country
        ORDER BY clicks DESC
        LIMIT 50`;

      const ispData = await prisma.$queryRawUnsafe(sql, ...params);
      
      const result = (ispData as any[]).map(row => ({
        ...row,
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
      }));

      res.json(result);
      return;
    } catch (error) {
      console.error('Geo ISP error:', error);
      next(error);
    }
  }

  static async getLanguages(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Languages are not stored directly in the schema
      // Return empty array with a message
      res.json({
        data: [],
        message: 'Language tracking requires additional configuration',
      });
      return;
    } catch (error) {
      console.error('Geo Languages error:', error);
      next(error);
    }
  }

  static async getTimezones(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Timezone is not stored in the current schema
      // Return empty array
      res.json([]);
      return;
    } catch (error) {
      console.error('Geo Timezones error:', error);
      next(error);
    }
  }

  static async getMapData(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const mapData = await prisma.$queryRaw`
        SELECT 
          c.country,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv."clickId" = c."clickId"
        WHERE c.country IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.country
        ORDER BY clicks DESC
      `;

      const result = (mapData as any[]).map(row => ({
        ...row,
        clicks: Number(row.clicks) || 0,
        conversions: Number(row.conversions) || 0,
        revenue: Number(row.revenue) || 0,
      }));

      res.json(result);
      return;
    } catch (error) {
      console.error('Geo Map error:', error);
      next(error);
    }
  }
}