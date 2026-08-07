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

      const countries = await prisma.$queryRaw`
        SELECT 
          country as id,
          country as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue,
          CASE 
            WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
            ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
          END as conversion_rate
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
        WHERE country IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY country
        ORDER BY clicks DESC
      `;

      // Calculate percentages
      const total = (countries as any[]).reduce((sum, row) => sum + Number(row.clicks), 0);
      const result = (countries as any[]).map(row => ({
        ...row,
        percentage: total > 0 ? (Number(row.clicks) / total) * 100 : 0,
      }));

      await cache.set(cacheKey, result, 300);
      res.json(result);
      return;
    } catch (error) {
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
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
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
      res.json(states);
      return;
    } catch (error) {
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
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
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
      res.json(cities);
      return;
    } catch (error) {
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
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
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
      res.json(ispData);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getLanguages(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Note: Languages are not stored directly in our schema
      // This would need to be derived from country or a separate lookup
      // For now, return a sample response
      res.json({
        message: 'Language tracking requires additional configuration',
        data: [],
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getTimezones(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const timezones = await prisma.$queryRaw`
        SELECT 
          c.timezone as id,
          c.timezone as label,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
        WHERE c.timezone IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.timezone
        ORDER BY clicks DESC
        LIMIT 50
      `;

      res.json(timezones);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getMapData(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const mapData = await prisma.$queryRaw`
        SELECT 
          c.country,
          c.latitude,
          c.longitude,
          COUNT(DISTINCT c.id) as clicks,
          COUNT(DISTINCT conv.id) as conversions,
          COALESCE(SUM(conv.revenue), 0) as revenue
        FROM "clicks" c
        LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
        WHERE c.country IS NOT NULL
          AND c.latitude IS NOT NULL
          AND c.longitude IS NOT NULL
          AND c.timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY c.country, c.latitude, c.longitude
        ORDER BY clicks DESC
      `;

      res.json(mapData);
      return;
    } catch (error) {
      next(error);
    }
  }
}