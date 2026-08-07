import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';

export class GeoService {
  static async getCountries() {
    const cacheKey = 'geo:countries';
    const cached = await cache.get(cacheKey);

    if (cached) {
      return cached;
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
    return result;
  }

  static async getStates(country?: string) {
    const whereClause = country ? `AND c.country = '${country}'` : '';

    const states = await prisma.$queryRaw`
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
        ${prisma.$raw(whereClause)}
        AND c.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY c.city, c.country
      ORDER BY clicks DESC
      LIMIT 100
    `;

    return states;
  }

  static async getCities(country?: string, state?: string) {
    let whereClause = '';
    if (country) {
      whereClause += `AND c.country = '${country}'`;
    }
    if (state) {
      whereClause += `AND c.city = '${state}'`;
    }

    const cities = await prisma.$queryRaw`
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
        ${prisma.$raw(whereClause)}
        AND c.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY c.city, c.country, c.region
      ORDER BY clicks DESC
      LIMIT 100
    `;

    return cities;
  }

  static async getISP(country?: string) {
    const whereClause = country ? `AND c.country = '${country}'` : '';

    const ispData = await prisma.$queryRaw`
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
        ${prisma.$raw(whereClause)}
        AND c.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY c.isp, c.country
      ORDER BY clicks DESC
      LIMIT 50
    `;

    return ispData;
  }

  static async getMapData() {
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

    return mapData;
  }
}