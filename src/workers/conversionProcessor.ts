import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

interface ConversionData {
  conversionId: string;
  offerId: string;
  networkId: string;
  clickId?: string;
  revenue?: number;
  payout?: number;
  status?: string;
  country?: string;
  device?: string;
  browser?: string;
  ip?: string;
  userAgent?: string;
}

export class ConversionProcessor {
  static async process(data: ConversionData): Promise<void> {
    try {
      // Validate offer
      const offer = await prisma.offer.findUnique({
        where: { id: data.offerId },
      });

      if (!offer) {
        logger.error('Offer not found for conversion', { offerId: data.offerId });
        return;
      }

      // Validate network
      const network = await prisma.network.findUnique({
        where: { id: data.networkId },
      });

      if (!network) {
        logger.error('Network not found for conversion', { networkId: data.networkId });
        return;
      }

      // Check for duplicate conversion
      const existing = await prisma.conversion.findUnique({
        where: { conversionId: data.conversionId },
      });

      if (existing) {
        logger.warn('Duplicate conversion detected', { conversionId: data.conversionId });
        return;
      }

      // Create conversion
      const conversion = await prisma.conversion.create({
        data: {
          conversionId: data.conversionId,
          offerId: data.offerId,
          networkId: data.networkId,
          clickId: data.clickId,
          revenue: data.revenue,
          payout: data.payout,
          status: data.status || 'PENDING',
          country: data.country,
          device: data.device,
          browser: data.browser,
          ip: data.ip,
          userAgent: data.userAgent,
        },
      });

      // Update click with conversion info
      if (data.clickId) {
        await prisma.click.update({
          where: { clickId: data.clickId },
          data: {
            conversion: {
              connect: { id: conversion.id },
            },
          },
        });
      }

      // Update stats in Redis
      await this.updateStats(conversion);

      // Check for fraud
      await this.checkFraud(conversion);

      // Send postback
      await this.sendPostback(conversion);

      logger.info('Conversion processed', {
        conversionId: conversion.conversionId,
        offerId: data.offerId,
        networkId: data.networkId,
      });
    } catch (error) {
      logger.error('Conversion processing error:', error);
      throw error;
    }
  }

  private static async updateStats(conversion: any): Promise<void> {
    await redis.incr(`stats:conversions:${conversion.offerId}`);
    await redis.incr(`stats:conversions:${conversion.networkId}`);
    await redis.incr('stats:conversions:today');
    await redis.incr('stats:conversions:total');

    if (conversion.revenue) {
      await redis.incr(`stats:revenue:${conversion.offerId}`);
      await redis.incr(`stats:revenue:${conversion.networkId}`);
      await redis.incr('stats:revenue:today');
      await redis.incr('stats:revenue:total');
    }
  }

  private static async checkFraud(conversion: any): Promise<void> {
    // Check for duplicate conversions from same IP
    if (conversion.ip) {
      const duplicates = await prisma.conversion.count({
        where: {
          ip: conversion.ip,
          timestamp: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // 1 hour window
          },
        },
      });

      if (duplicates > 3) {
        await prisma.conversion.update({
          where: { id: conversion.id },
          data: {
            isFraudulent: true,
            fraudReasons: 'Multiple conversions from same IP',
          },
        });

        await prisma.fraudSignal.create({
          data: {
            type: 'DUPLICATE_CONVERSION',
            label: 'Multiple Conversions from Same IP',
            count: duplicates,
            riskLevel: 'HIGH',
            ipAddress: conversion.ip,
            details: JSON.stringify({
              conversionId: conversion.id,
              count: duplicates,
            }),
          },
        });
      }
    }
  }

  private static async sendPostback(conversion: any): Promise<void> {
    try {
      // Get postback configuration
      const config = await this.getPostbackConfig(conversion);

      if (!config.url) {
        logger.debug('No postback URL configured', { conversionId: conversion.id });
        return;
      }

      // Send postback
      const response = await this.sendRequest(config.url, config.method, {
        conversion_id: conversion.conversionId,
        offer_id: conversion.offerId,
        network_id: conversion.networkId,
        revenue: conversion.revenue,
        payout: conversion.payout,
        status: conversion.status,
        timestamp: conversion.timestamp.toISOString(),
      });

      // Log postback
      await prisma.postbackLog.create({
        data: {
          scope: 'CONVERSION',
          scopeId: conversion.id,
          url: config.url,
          method: config.method,
          payload: {
            conversion_id: conversion.conversionId,
            offer_id: conversion.offerId,
            network_id: conversion.networkId,
          },
          response: JSON.stringify(response.data),
          statusCode: response.status,
          success: response.status >= 200 && response.status < 300,
        },
      });
    } catch (error) {
      logger.error('Postback error:', error);
      
      // Log failed postback
      await prisma.postbackLog.create({
        data: {
          scope: 'CONVERSION',
          scopeId: conversion.id,
          url: 'N/A',
          method: 'POST',
          payload: { conversionId: conversion.id },
          success: false,
          error: error.message,
        },
      });
    }
  }

  private static async getPostbackConfig(conversion: any): Promise<any> {
    // Check network postback first
    const network = await prisma.network.findUnique({
      where: { id: conversion.networkId },
    });

    if (network?.postbackUrl) {
      return {
        url: network.postbackUrl,
        method: 'POST',
      };
    }

    // Check global postback config
    const globalConfig = await prisma.$queryRaw`
      SELECT * FROM "postback_configs" 
      WHERE scope = 'GLOBAL' 
      LIMIT 1
    `;

    if ((globalConfig as any[]).length > 0) {
      return (globalConfig as any[])[0];
    }

    return { url: '', method: 'POST' };
  }

  private static async sendRequest(url: string, method: string, data: any): Promise<any> {
    const axios = require('axios');
    return axios({
      method: method.toLowerCase(),
      url,
      data,
      timeout: 10000,
      validateStatus: () => true,
    });
  }
}