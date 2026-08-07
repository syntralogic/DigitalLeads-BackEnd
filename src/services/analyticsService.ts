import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { logger } from '../config/logger';

export class AnalyticsService {
  static async getReport(params: {
    dimension: string;
    granularity: string;
    from?: Date;
    to?: Date;
    search?: string;
  }) {
    const { dimension, granularity, from, to, search } = params;

    const dateRange = {
      gte: from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lte: to || new Date(),
    };

    const dimensionField = this.getDimensionField(dimension);

    if (!dimensionField) {
      throw new Error('Invalid dimension');
    }

    const report = await prisma.$queryRaw`
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
      LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
      WHERE c.timestamp >= ${dateRange.gte} 
        AND c.timestamp <= ${dateRange.lte}
        ${search ? prisma.$raw`AND ${dimensionField} ILIKE ${`%${search}%`}` : prisma.$raw``}
      GROUP BY ${dimensionField}
      ORDER BY clicks DESC
      LIMIT 50
    `;

    return {
      dimension,
      granularity,
      dateRange,
      data: report || [],
    };
  }

  static async getSeries(params: {
    dimension: string;
    granularity: string;
    from?: Date;
    to?: Date;
  }) {
    const { dimension, granularity, from, to } = params;

    const dateRange = {
      gte: from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lte: to || new Date(),
    };

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
        COUNT(DISTINCT click_id) as unique_clicks,
        COALESCE(SUM(revenue), 0) as revenue
      FROM "conversions"
      WHERE timestamp >= ${dateRange.gte} 
        AND timestamp <= ${dateRange.lte}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    return (series as any[]).map(item => ({
      timestamp: item.time_bucket.toISOString(),
      clicks: Number(item.clicks),
      uniqueClicks: Number(item.unique_clicks),
      revenue: Number(item.revenue),
    }));
  }

  static async export(params: {
    dimension: string;
    granularity: string;
    from?: Date;
    to?: Date;
    format?: string;
  }) {
    const { dimension, format = 'csv', ...rest } = params;
    const report = await this.getReport(rest);

    if (format === 'csv') {
      const headers = ['ID', 'Label', 'Clicks', 'Conversions', 'Revenue', 'Payout', 'Conversion Rate', 'EPC'];
      const rows = (report.data as any[]).map(item => [
        item.id || '',
        item.label || '',
        Number(item.clicks) || 0,
        Number(item.conversions) || 0,
        Number(item.revenue) || 0,
        Number(item.payout) || 0,
        Number(item.conversion_rate) || 0,
        Number(item.epc) || 0,
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      return { content: csvContent, format: 'csv' };
    }

    return { data: report, format: 'json' };
  }

  static async getGeo(level: string) {
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
        throw new Error('Invalid geo level');
    }

    const geoData = await prisma.$queryRaw`
      SELECT 
        ${groupBy} as id,
        ${groupBy} as label,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.revenue), 0) as revenue
      FROM "clicks" c
      LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
      WHERE ${groupBy} IS NOT NULL
        AND c.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY ${groupBy}
      ORDER BY clicks DESC
      LIMIT 100
    `;

    return geoData;
  }

  static async getDevices() {
    const devices = await prisma.$queryRaw`
      SELECT 
        device as id,
        device as label,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.revenue), 0) as revenue,
        CASE 
          WHEN COUNT(DISTINCT c.id) = 0 THEN 0 
          ELSE (COUNT(DISTINCT conv.id)::float / COUNT(DISTINCT c.id)) * 100 
        END as conversion_rate
      FROM "clicks" c
      LEFT JOIN "conversions" conv ON conv.click_id = c.click_id
      WHERE device IS NOT NULL
        AND c.timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY device
      ORDER BY clicks DESC
    `;

    return devices;
  }

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
}