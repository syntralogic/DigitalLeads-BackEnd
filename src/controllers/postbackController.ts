import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { cache } from '../config/redis';
import { AppError } from '../middleware/errorHandler';
import axios from 'axios';

export class PostbackController {
  static async getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { scope } = req.params;
      const { scopeId } = req.query;

      const cacheKey = `postback:config:${scope}:${scopeId || 'global'}`;
      const cached = await cache.get(cacheKey);

      if (cached) {
        res.json(cached);
        return;
      }

      let config: any = {
        url: '',
        method: 'POST',
        retries: 3,
        enabled: true,
      };

      // Get configuration based on scope
      if (scope === 'global') {
        // Try to get from Redis first
        const globalUrl = await cache.get('postback:global:url');
        const globalMethod = await cache.get('postback:global:method');
        const globalRetries = await cache.get('postback:global:retries');
        const globalEnabled = await cache.get('postback:global:enabled');

        if (globalUrl) {
          config.url = globalUrl;
          config.method = globalMethod || 'POST';
          // Fix: Ensure globalRetries is a string before parseInt
          const retriesValue = globalRetries ? String(globalRetries) : '3';
          config.retries = parseInt(retriesValue, 10) || 3;
          config.enabled = globalEnabled !== 'false';
        }
      } else if (scope === 'network' && scopeId) {
        const network = await prisma.network.findUnique({
          where: { id: scopeId as string },
          select: { postbackUrl: true },
        });
        if (network?.postbackUrl) {
          config.url = network.postbackUrl;
        }
      } else if (scope === 'offer' && scopeId) {
        const offer = await prisma.offer.findUnique({
          where: { id: scopeId as string },
          include: { network: true },
        });
        if (offer?.network?.postbackUrl) {
          config.url = offer.network.postbackUrl;
        }
      }

      await cache.set(cacheKey, config, 60);
      res.json(config);
      return;
    } catch (error) {
      console.error('Get config error:', error);
      next(error);
    }
  }

  static async saveConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { scope } = req.params;
      const { url, method, retries, enabled } = req.body;

      // Save to Redis cache
      await cache.set(`postback:global:url`, url);
      await cache.set(`postback:global:method`, method || 'POST');
      await cache.set(`postback:global:retries`, String(retries || 3));
      await cache.set(`postback:global:enabled`, String(enabled !== false));

      await cache.delPattern(`postback:config:${scope}:*`);

      // Log the configuration change
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'UPDATE',
          resource: 'PostbackConfig',
          resourceId: scope,
          changes: { url, method, retries, enabled },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        message: 'Postback configuration saved successfully',
      });
      return;
    } catch (error) {
      console.error('Save config error:', error);
      next(error);
    }
  }

  static async getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = 1,
        pageSize = 25,
        status,
        search,
        from,
        to,
      } = req.query;

      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      const where: any = {};
      if (status) {
        where.success = status === 'success';
      }
      if (search) {
        where.OR = [
          { url: { contains: search as string, mode: 'insensitive' } },
          { response: { contains: search as string, mode: 'insensitive' } },
        ];
      }
      if (from || to) {
        where.timestamp = {};
        if (from) {
          where.timestamp.gte = new Date(from as string);
        }
        if (to) {
          where.timestamp.lte = new Date(to as string);
        }
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

      const result = {
        data: logs,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / Number(pageSize)),
        },
      };

      res.json(result);
      return;
    } catch (error) {
      console.error('Get logs error:', error);
      next(error);
    }
  }

  static async retry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const log = await prisma.postbackLog.findUnique({
        where: { id },
      });

      if (!log) {
        throw new AppError('Postback log not found', 404);
      }

      if (log.success) {
        throw new AppError('Postback already succeeded', 400);
      }

      // Send postback again
      const result = await this.sendPostback(log.url, log.method, log.payload as any);

      // Update log
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

      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'RETRY_POSTBACK',
          resource: 'PostbackLog',
          resourceId: id,
          changes: { retryCount: updated.retryCount, success: updated.success },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.json({
        success: true,
        data: updated,
      });
      return;
    } catch (error) {
      console.error('Retry error:', error);
      next(error);
    }
  }

  static async test(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { url } = req.body;

      if (!url) {
        throw new AppError('URL is required', 400);
      }

      const result = await this.sendPostback(url, 'POST', { test: true });

      // Log test
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

      res.json({
        ok: result.success,
        responseCode: result.statusCode,
        message: result.success ? 'Postback test successful' : 'Postback test failed',
        details: result,
      });
      return;
    } catch (error) {
      console.error('Test error:', error);
      next(error);
    }
  }

  private static async sendPostback(url: string, method: string, payload: any): Promise<any> {
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