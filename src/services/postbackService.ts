import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import axios from 'axios';

export class PostbackService {
  static async getConfig(scope: string, scopeId?: string) {
    let config: any = {
      url: '',
      method: 'POST',
      retries: 3,
    };

    if (scope === 'global') {
      const globalConfig = await prisma.$queryRaw`
        SELECT * FROM "postback_configs" 
        WHERE scope = 'GLOBAL' 
        LIMIT 1
      `;
      if ((globalConfig as any[]).length > 0) {
        config = (globalConfig as any[])[0];
      }
    } else if (scope === 'network' && scopeId) {
      const network = await prisma.network.findUnique({
        where: { id: scopeId },
        select: { postbackUrl: true },
      });
      if (network?.postbackUrl) {
        config.url = network.postbackUrl;
      }
    } else if (scope === 'offer' && scopeId) {
      const offer = await prisma.offer.findUnique({
        where: { id: scopeId },
        include: { network: true },
      });
      if (offer?.network?.postbackUrl) {
        config.url = offer.network.postbackUrl;
      }
    }

    return config;
  }

  static async saveConfig(scope: string, data: { url: string; method: string; retries: number }) {
    await prisma.$executeRaw`
      INSERT INTO "postback_configs" (scope, url, method, retries, updated_at)
      VALUES (${scope.toUpperCase()}, ${data.url}, ${data.method}, ${data.retries}, NOW())
      ON CONFLICT (scope) 
      DO UPDATE SET 
        url = ${data.url},
        method = ${data.method},
        retries = ${data.retries},
        updated_at = NOW()
    `;

    return { success: true };
  }

  static async getLogs(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
    from?: Date;
    to?: Date;
  }) {
    const { page = 1, pageSize = 25, status, search, from, to } = params;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};
    if (status) {
      where.success = status === 'success';
    }
    if (search) {
      where.OR = [
        { url: { contains: search, mode: 'insensitive' } },
        { response: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = from;
      if (to) where.timestamp.lte = to;
    }

    const [logs, total] = await Promise.all([
      prisma.postbackLog.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
      }),
      prisma.postbackLog.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async retry(id: string) {
    const log = await prisma.postbackLog.findUnique({
      where: { id },
    });

    if (!log) {
      throw new Error('Postback log not found');
    }

    const result = await this.sendPostback(log.url, log.method, log.payload as any);

    const updated = await prisma.postbackLog.update({
      where: { id },
      data: {
        retryCount: log.retryCount + 1,
        success: result.success,
        response: result.response,
        statusCode: result.statusCode,
        error: result.error || null,
        timestamp: new Date(),
      },
    });

    return updated;
  }

  static async test(url: string) {
    const result = await this.sendPostback(url, 'POST', { test: true });

    await prisma.postbackLog.create({
      data: {
        scope: 'GLOBAL',
        url,
        method: 'POST',
        payload: { test: true },
        response: result.response,
        statusCode: result.statusCode,
        success: result.success,
        error: result.error,
      },
    });

    return result;
  }

  private static async sendPostback(url: string, method: string, payload: any) {
    try {
      const response = await axios({
        method: method.toLowerCase() as any,
        url,
        data: payload,
        timeout: 10000,
        validateStatus: () => true,
      });

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        response: JSON.stringify(response.data),
        error: response.status >= 400 ? response.statusText : null,
      };
    } catch (error: any) {
      return {
        success: false,
        statusCode: 500,
        response: null,
        error: error.message || 'Postback failed',
      };
    }
  }
}