import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { geoipUtils } from '../utils/geoip';
import { userAgentUtils } from '../utils/userAgent';
import { v4 as uuidv4 } from 'uuid';

interface ClickData {
  offerId: string;
  networkId: string;
  ip: string;
  userAgent: string;
  referrer?: string;
  campaign?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  sub6?: string;
  sub7?: string;
  sub8?: string;
  sub9?: string;
  sub10?: string;
}

export class ClickProcessor {
  static async process(clickData: ClickData): Promise<string> {
    try {
      // Generate unique click ID
      const clickId = `cl_${uuidv4().replace(/-/g, '')}`;

      // Parse user agent
      const deviceInfo = userAgentUtils.parse(clickData.userAgent);

      // Get geo data
      const geoData = geoipUtils.getGeoData(clickData.ip);

      // Check for fraud
      const isFraudulent = await this.detectFraud(clickData, deviceInfo);

      // Create click record
      const click = await prisma.click.create({
        data: {
          clickId,
          ip: clickData.ip,
          country: geoData?.country || null,
          city: geoData?.city || null,
          device: deviceInfo.device,
          os: deviceInfo.os,
          browser: deviceInfo.browser,
          isp: null, // Would need ISP lookup service
          carrier: null,
          referrer: clickData.referrer || null,
          campaign: clickData.campaign || null,
          sub1: clickData.sub1 || null,
          sub2: clickData.sub2 || null,
          sub3: clickData.sub3 || null,
          sub4: clickData.sub4 || null,
          sub5: clickData.sub5 || null,
          sub6: clickData.sub6 || null,
          sub7: clickData.sub7 || null,
          sub8: clickData.sub8 || null,
          sub9: clickData.sub9 || null,
          sub10: clickData.sub10 || null,
          offerId: clickData.offerId,
          networkId: clickData.networkId,
          isFraudulent,
          userAgent: clickData.userAgent,
          sessionId: this.generateSessionId(clickData),
        },
      });

      // Increment click count in Redis
      await redis.incr(`stats:clicks:${clickData.offerId}`);
      await redis.incr(`stats:clicks:${clickData.networkId}`);
      await redis.incr(`stats:clicks:today`);

      // Queue for analytics processing
      await redis.lpush('analytics:queue', JSON.stringify({
        type: 'click',
        clickId: click.clickId,
        timestamp: new Date().toISOString(),
        offerId: clickData.offerId,
        networkId: clickData.networkId,
        country: geoData?.country || null,
      }));

      logger.info('Click processed', {
        clickId: click.clickId,
        offerId: clickData.offerId,
        networkId: clickData.networkId,
        isFraudulent,
      });

      // Check for fraud triggers
      if (isFraudulent) {
        await this.handleFraudDetected(clickData, deviceInfo);
      }

      return click.clickId;
    } catch (error) {
      logger.error('Click processing error:', error);
      throw error;
    }
  }

  private static async detectFraud(clickData: ClickData, deviceInfo: any): Promise<boolean> {
    // Check for duplicate clicks (same IP, same offer, within time window)
    const duplicateCheck = await prisma.click.findFirst({
      where: {
        ip: clickData.ip,
        offerId: clickData.offerId,
        timestamp: {
          gte: new Date(Date.now() - 60 * 1000), // 1 minute window
        },
      },
    });

    if (duplicateCheck) {
      return true;
    }

    // Check for VPN/Proxy (simplified - would use 3rd party service in production)
    // Placeholder logic
    const isVPN = false;

    // Check for bot detection
    const isBot = deviceInfo.isBot;

    // Check for blacklisted IPs
    const isBlacklisted = await redis.sismember('blacklist:ips', clickData.ip);

    return isBot || isVPN || isBlacklisted;
  }

  private static generateSessionId(clickData: ClickData): string {
    // Simple session generation based on IP and user agent
    const components = [
      clickData.ip,
      clickData.userAgent,
      new Date().toDateString(),
    ];
    return `sess_${Buffer.from(components.join('|')).toString('base64').substring(0, 20)}`;
  }

  private static async handleFraudDetected(clickData: ClickData, deviceInfo: any): Promise<void> {
    // Create fraud signal
    await prisma.fraudSignal.create({
      data: {
        type: 'DUPLICATE_CLICK',
        label: 'Duplicate Click Detected',
        count: 1,
        riskLevel: 'HIGH',
        ipAddress: clickData.ip,
        details: JSON.stringify({
          offerId: clickData.offerId,
          networkId: clickData.networkId,
          deviceInfo,
        }),
      },
    });

    // Notify about fraud
    await redis.publish('fraud:detected', JSON.stringify({
      type: 'DUPLICATE_CLICK',
      ip: clickData.ip,
      offerId: clickData.offerId,
      timestamp: new Date().toISOString(),
    }));

    logger.warn('Fraud detected', {
      type: 'DUPLICATE_CLICK',
      ip: clickData.ip,
      offerId: clickData.offerId,
    });
  }
}