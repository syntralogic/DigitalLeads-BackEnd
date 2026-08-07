import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class FraudService {
  static async getSignals() {
    const signals = await prisma.fraudSignal.findMany({
      where: {
        resolved: false,
        timestamp: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    // Group by type
    const grouped = signals.reduce((acc, signal) => {
      const key = signal.type;
      if (!acc[key]) {
        acc[key] = {
          key: signal.type,
          label: signal.label,
          count: 0,
          riskLevel: 'LOW',
        };
      }
      acc[key].count += signal.count || 1;
      if (signal.riskLevel === 'CRITICAL' || signal.riskLevel === 'HIGH') {
        acc[key].riskLevel = signal.riskLevel;
      }
      return acc;
    }, {} as Record<string, any>);

    const result = Object.values(grouped);

    // Add default signals if none exist
    if (result.length === 0) {
      return [
        { key: 'vpn', label: 'VPN Detection', count: 0, riskLevel: null },
        { key: 'proxy', label: 'Proxy Detection', count: 0, riskLevel: null },
        { key: 'bot', label: 'Bot Detection', count: 0, riskLevel: null },
        { key: 'dup_clicks', label: 'Duplicate Clicks', count: 0, riskLevel: null },
        { key: 'dup_conversions', label: 'Duplicate Conversions', count: 0, riskLevel: null },
        { key: 'fake_leads', label: 'Fake Leads', count: 0, riskLevel: null },
        { key: 'blacklist_ip', label: 'Blacklisted IP', count: 0, riskLevel: null },
        { key: 'high_risk_ip', label: 'High Risk IP', count: 0, riskLevel: null },
      ];
    }

    return result;
  }

  static async getScore() {
    // Get from Redis cache
    const cachedScore = await redis.get('fraud:score');
    const cachedRisk = await redis.get('fraud:riskLevel');

    if (cachedScore && cachedRisk) {
      return {
        fraudScore: Number(cachedScore),
        riskLevel: cachedRisk,
      };
    }

    // Calculate score
    const [signals, invalidClicks] = await Promise.all([
      prisma.fraudSignal.count({
        where: {
          resolved: false,
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.click.count({
        where: {
          isFraudulent: true,
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    // Calculate score (0-100)
    let score = 0;
    score += Math.min(signals * 5, 50);
    score += Math.min(invalidClicks * 2, 50);

    let riskLevel = 'LOW';
    if (score >= 70) riskLevel = 'CRITICAL';
    else if (score >= 50) riskLevel = 'HIGH';
    else if (score >= 30) riskLevel = 'MEDIUM';

    // Cache
    await redis.set('fraud:score', score, 'EX', 300);
    await redis.set('fraud:riskLevel', riskLevel, 'EX', 300);

    return { fraudScore: score, riskLevel };
  }

  static async getTimeline() {
    const timeline = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('day', timestamp) as time_bucket,
        COUNT(*) as count
      FROM "fraud_signals"
      WHERE timestamp >= NOW() - INTERVAL '30 days'
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    return (timeline as any[]).map(item => ({
      timestamp: item.time_bucket.toISOString(),
      value: Number(item.count),
    }));
  }

  static async getInvalidClicks() {
    const invalidClicks = await prisma.click.findMany({
      where: {
        isFraudulent: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 50,
      select: {
        id: true,
        ip: true,
        fraudReasons: true,
        timestamp: true,
        country: true,
        device: true,
        offer: {
          select: { name: true },
        },
      },
    });

    return invalidClicks.map(click => ({
      id: click.id,
      ip: click.ip || 'Unknown',
      reason: click.fraudReasons || 'Suspicious activity',
      time: click.timestamp.toISOString(),
      country: click.country || 'Unknown',
      device: click.device || 'Unknown',
      offer: click.offer?.name || 'Unknown',
    }));
  }

  static async blockIp(ip: string, userId: string) {
    // Add to Redis blacklist
    await redis.sadd('blacklist:ips', ip);

    // Create fraud signal
    const signal = await prisma.fraudSignal.create({
      data: {
        type: 'BLACKLISTED_IP',
        label: 'IP Manually Blocked',
        ipAddress: ip,
        riskLevel: 'CRITICAL',
        details: JSON.stringify({
          blockedBy: userId,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    return signal;
  }

  static async scanForFraud() {
    try {
      // Check for duplicate conversions
      await this.detectDuplicateConversions();

      // Check for high risk IPs
      await this.detectHighRiskIPs();

      // Update fraud scores
      await this.getScore();

      logger.info('Fraud scan completed');
    } catch (error) {
      logger.error('Fraud scan error:', error);
    }
  }

  private static async detectDuplicateConversions() {
    const windowMinutes = 60;
    const threshold = 3;

    const suspiciousIPs = await prisma.$queryRaw`
      SELECT 
        ip,
        COUNT(*) as conversion_count,
        array_agg(id) as conversion_ids
      FROM "conversions"
      WHERE timestamp >= NOW() - INTERVAL '${windowMinutes} minutes'
        AND ip IS NOT NULL
        AND is_fraudulent = false
      GROUP BY ip
      HAVING COUNT(*) > ${threshold}
    `;

    for (const row of suspiciousIPs as any[]) {
      await prisma.conversion.updateMany({
        where: {
          id: { in: row.conversion_ids },
        },
        data: {
          isFraudulent: true,
          fraudReasons: 'Duplicate conversions from same IP',
        },
      });

      await prisma.fraudSignal.create({
        data: {
          type: 'DUPLICATE_CONVERSION',
          label: 'Multiple Conversions from Same IP',
          count: row.conversion_count,
          riskLevel: 'HIGH',
          ipAddress: row.ip,
          details: JSON.stringify({
            conversionIds: row.conversion_ids,
            count: row.conversion_count,
          }),
        },
      });
    }
  }

  private static async detectHighRiskIPs() {
    const highRiskIPs = await prisma.$queryRaw`
      SELECT 
        ip,
        COUNT(*) as total,
        SUM(CASE WHEN is_fraudulent THEN 1 ELSE 0 END) as fraudulent_count
      FROM "clicks"
      WHERE ip IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY ip
      HAVING 
        COUNT(*) > 10 AND
        SUM(CASE WHEN is_fraudulent THEN 1 ELSE 0 END)::float / COUNT(*) > 0.5
    `;

    for (const row of highRiskIPs as any[]) {
      await redis.sadd('blacklist:ips', row.ip);

      await prisma.fraudSignal.create({
        data: {
          type: 'HIGH_RISK_IP',
          label: 'High Risk IP Detected',
          count: row.fraudulent_count,
          riskLevel: 'CRITICAL',
          ipAddress: row.ip,
          details: JSON.stringify({
            total: row.total,
            fraudulent: row.fraudulent_count,
            ratio: row.fraudulent_count / row.total,
          }),
        },
      });
    }
  }
}