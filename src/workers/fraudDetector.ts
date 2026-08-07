import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export class FraudDetector {
  static async scanForFraud(): Promise<void> {
    try {
      // Check for duplicate conversions
      await this.detectDuplicateConversions();

      // Check for high risk IPs
      await this.detectHighRiskIPs();

      // Check for VPN/Proxy (would use external service)
      await this.detectVPNProxy();

      // Update fraud scores
      await this.updateFraudScores();

      logger.info('Fraud scan completed');
    } catch (error) {
      logger.error('Fraud scan error:', error);
    }
  }

  private static async detectDuplicateConversions(): Promise<void> {
    const windowMinutes = 60;
    const threshold = 3;

    // Find IPs with multiple conversions in short time window
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
      logger.warn('Suspicious conversion pattern detected', {
        ip: row.ip,
        count: row.conversion_count,
        ids: row.conversion_ids,
      });

      // Mark as fraudulent
      await prisma.conversion.updateMany({
        where: {
          id: { in: row.conversion_ids },
        },
        data: {
          isFraudulent: true,
          fraudReasons: 'Duplicate conversions from same IP',
        },
      });

      // Create fraud signal
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

  private static async detectHighRiskIPs(): Promise<void> {
    // Get IPs with high fraud score
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
      // Add to blacklist
      await redis.sadd('blacklist:ips', row.ip);

      // Create fraud signal
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

      logger.warn('IP added to blacklist', {
        ip: row.ip,
        fraudulentCount: row.fraudulent_count,
        total: row.total,
      });
    }
  }

  private static async detectVPNProxy(): Promise<void> {
    // In production, this would use a 3rd party service
    // Placeholder implementation
    logger.info('VPN/Proxy detection scan completed');
  }

  private static async updateFraudScores(): Promise<void> {
    // Calculate fraud scores for recent activity
    const fraudScore = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as fraud_count,
        COUNT(*) FILTER (WHERE risk_level = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE risk_level = 'HIGH') as high_count,
        COUNT(*) FILTER (WHERE risk_level = 'MEDIUM') as medium_count
      FROM "fraud_signals"
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
        AND resolved = false
    `;

    const result = (fraudScore as any[])[0] || {
      fraud_count: 0,
      critical_count: 0,
      high_count: 0,
      medium_count: 0,
    };

    const score = Math.min(
      100,
      (result.critical_count * 25) +
      (result.high_count * 10) +
      (result.medium_count * 5)
    );

    // Store in Redis
    await redis.set('fraud:score', score, 300);

    // Determine risk level
    let riskLevel = 'LOW';
    if (score >= 70) riskLevel = 'CRITICAL';
    else if (score >= 50) riskLevel = 'HIGH';
    else if (score >= 30) riskLevel = 'MEDIUM';

    // Store risk level
    await redis.set('fraud:riskLevel', riskLevel, 300);

    logger.info('Fraud score updated', { score, riskLevel });
  }
}