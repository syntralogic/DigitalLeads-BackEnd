// src/workers/clickProcessor.ts
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
      // Validate required fields
      if (!clickData.offerId || !clickData.networkId) {
        throw new Error('Offer ID and Network ID are required');
      }

      // Generate unique click ID
      const clickId = `cl_${uuidv4().replace(/-/g, '')}`;

      // Parse user agent
      const deviceInfo = userAgentUtils.parse(clickData.userAgent);

      // Get geo data
      const geoData = geoipUtils.getGeoData(clickData.ip);

      // Check for fraud - ensure boolean return
      const isFraudulent = await this.detectFraud(clickData);

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
          isp: null,
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
          isFraudulent: isFraudulent, // Must be boolean
          userAgent: clickData.userAgent,
          sessionId: this.generateSessionId(clickData),
        },
      });

      // Update stats in Redis
      await this.updateStats(click);

      logger.info('Click processed successfully', {
        clickId: click.clickId,
        offerId: clickData.offerId,
        networkId: clickData.networkId,
        isFraudulent,
      });

      return click.clickId;
    } catch (error) {
      logger.error('Click processing error:', error);
      throw error;
    }
  }

  // ✅ Fix: Return boolean, not number
  private static async detectFraud(clickData: ClickData): Promise<boolean> {
    try {
      // Check for duplicate clicks (same IP, same offer, within time window)
      const duplicate = await prisma.click.findFirst({
        where: {
          ip: clickData.ip,
          offerId: clickData.offerId,
          timestamp: {
            gte: new Date(Date.now() - 60 * 1000), // 1 minute window
          },
        },
      });

      if (duplicate) {
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
            }),
          },
        });
        return true; // ✅ Return boolean
      }

      // Check for bot
      const deviceInfo = userAgentUtils.parse(clickData.userAgent);
      if (deviceInfo.isBot) {
        await prisma.fraudSignal.create({
          data: {
            type: 'BOT',
            label: 'Bot Detected',
            count: 1,
            riskLevel: 'MEDIUM',
            ipAddress: clickData.ip,
            details: JSON.stringify({
              userAgent: clickData.userAgent,
              offerId: clickData.offerId,
            }),
          },
        });
        return true; // ✅ Return boolean
      }

      // Check for blacklisted IP
      const isBlacklisted = await redis.sismember('blacklist:ips', clickData.ip);
      if (isBlacklisted) {
        return true; // ✅ Return boolean
      }

      return false; // ✅ Return boolean
    } catch (error) {
      logger.error('Fraud detection error:', error);
      return false; // ✅ Return boolean on error
    }
  }

  private static generateSessionId(clickData: ClickData): string {
    const components = [
      clickData.ip,
      clickData.userAgent,
      new Date().toDateString(),
    ];
    return `sess_${Buffer.from(components.join('|')).toString('base64').substring(0, 20)}`;
  }

  private static async updateStats(click: any): Promise<void> {
    await redis.incr(`stats:clicks:${click.offerId}`);
    await redis.incr(`stats:clicks:${click.networkId}`);
    await redis.incr('stats:clicks:today');
    await redis.incr('stats:clicks:total');
  }
}