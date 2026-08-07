import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { AppError } from '../middleware/errorHandler';

export class FraudController {
  static async getSignals(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
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
        const defaultSignals = [
          { key: 'vpn', label: 'VPN Detection', count: 0, riskLevel: null },
          { key: 'proxy', label: 'Proxy Detection', count: 0, riskLevel: null },
          { key: 'bot', label: 'Bot Detection', count: 0, riskLevel: null },
          { key: 'dup_clicks', label: 'Duplicate Clicks', count: 0, riskLevel: null },
          { key: 'dup_conversions', label: 'Duplicate Conversions', count: 0, riskLevel: null },
          { key: 'fake_leads', label: 'Fake Leads', count: 0, riskLevel: null },
          { key: 'blacklist_ip', label: 'Blacklisted IP', count: 0, riskLevel: null },
          { key: 'high_risk_ip', label: 'High Risk IP', count: 0, riskLevel: null },
        ];
        res.json(defaultSignals);
        return;
      }

      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getScore(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Get from Redis cache
      const cachedScore = await redis.get('fraud:score');
      const cachedRisk = await redis.get('fraud:riskLevel');

      if (cachedScore && cachedRisk) {
        res.json({
          fraudScore: Number(cachedScore),
          riskLevel: cachedRisk,
        });
        return;
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

      // Cache - Fixed Redis set with proper parameters
      await redis.set('fraud:score', String(score), 'EX', 300);
      await redis.set('fraud:riskLevel', riskLevel, 'EX', 300);

      res.json({
        fraudScore: score,
        riskLevel,
      });
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getTimeline(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const timeline = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('day', timestamp) as time_bucket,
          COUNT(*) as count
        FROM "fraud_signals"
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
      `;

      const result = (timeline as any[]).map(item => ({
        timestamp: item.time_bucket.toISOString(),
        value: Number(item.count),
      }));

      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async getInvalidClicks(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
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

      const result = invalidClicks.map(click => ({
        id: click.id,
        ip: click.ip || 'Unknown',
        reason: click.fraudReasons || 'Suspicious activity',
        time: click.timestamp.toISOString(),
        country: click.country || 'Unknown',
        device: click.device || 'Unknown',
        offer: click.offer?.name || 'Unknown',
      }));

      res.json(result);
      return;
    } catch (error) {
      next(error);
    }
  }

  static async blockIp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { ip } = req.body;

      if (!ip) {
        throw new AppError('IP address is required', 400);
      }

      // Add to Redis blacklist
      await redis.sadd('blacklist:ips', ip);

      // Create fraud signal
      await prisma.fraudSignal.create({
        data: {
          type: 'BLACKLISTED_IP',
          label: 'IP Manually Blocked',
          ipAddress: ip,
          riskLevel: 'CRITICAL',
          details: JSON.stringify({
            blockedBy: req.user!.id,
            timestamp: new Date().toISOString(),
          }),
        },
      });

      // Log audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'BLOCK_IP',
          resource: 'IP',
          resourceId: ip,
          changes: { ip },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: `IP ${ip} has been blocked`,
      });
      return;
    } catch (error) {
      next(error);
    }
  }
}